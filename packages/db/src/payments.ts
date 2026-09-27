import { and, desc, eq, sql } from "drizzle-orm";
import type { PaymentOutcome } from "@float/contracts";
import type { Db } from "./client.js";
import { LedgerError } from "./errors.js";
import {
  advances,
  collectionReservations,
  ledgerEntries,
  paymentAttempts,
  paymentIntents,
} from "./schema.js";
import {
  getAdvance,
  markRepaidIfSettled,
  setAdvanceState,
} from "./advances.js";
import { debitBudgetRemaining } from "./budgets.js";
import {
  getIntent,
  reservationForIntent,
  type PaymentIntentRow,
} from "./reservations.js";
import { transactionWithAdvanceLock, type DbOrTx, type Tx } from "./tx.js";

async function getIntentInTx(
  tx: Tx,
  intentId: string,
): Promise<PaymentIntentRow> {
  const rows = await tx
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, intentId))
    .limit(1);
  const row = rows[0];
  if (!row)
    throw new LedgerError("INTERNAL_UNEXPECTED", `intent ${intentId} missing`);
  return row;
}

async function recordAttempt(
  tx: Tx,
  input: {
    intentId: string;
    txHash: string | null;
    submittedAt: Date | null;
    outcome: PaymentOutcome | null;
  },
): Promise<void> {
  await tx.insert(paymentAttempts).values({
    intentId: input.intentId,
    txHash: input.txHash,
    submittedAt: input.submittedAt,
    outcome: input.outcome,
  });
}

/** Journals the final outcome on the newest attempt carrying this txHash. */
async function attachOutcomeToAttempt(
  tx: Tx,
  intentId: string,
  txHash: string | null,
  outcome: PaymentOutcome,
): Promise<void> {
  if (txHash === null) {
    await recordAttempt(tx, {
      intentId,
      txHash: null,
      submittedAt: null,
      outcome,
    });
    return;
  }
  const rows = await tx
    .select({ id: paymentAttempts.id })
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.intentId, intentId),
        eq(paymentAttempts.txHash, txHash),
      ),
    )
    .orderBy(desc(paymentAttempts.createdAt))
    .limit(1);
  const attempt = rows[0];
  if (attempt) {
    await tx
      .update(paymentAttempts)
      .set({ outcome })
      .where(eq(paymentAttempts.id, attempt.id));
  } else {
    await recordAttempt(tx, { intentId, txHash, submittedAt: null, outcome });
  }
}

async function releaseReservation(
  tx: Tx,
  intentId: string,
  at: Date,
): Promise<void> {
  const reservation = await reservationForIntent(tx, intentId);
  if (reservation && reservation.status === "held") {
    await tx
      .update(collectionReservations)
      .set({ status: "released", updatedAt: at })
      .where(eq(collectionReservations.id, reservation.id));
  }
}

/**
 * Journals that a broadcast is IN FLIGHT: prepared -> submitted with no
 * txHash yet. Called before the adapter submit call so a crash cannot orphan
 * a prepared intent silently.
 */
export async function markIntentSubmitting(
  db: DbOrTx,
  intentId: string,
  at: Date = new Date(),
): Promise<PaymentIntentRow> {
  return db.transaction(async (tx) => {
    const intent = await getIntentInTx(tx, intentId);
    if (intent.state !== "prepared") return intent;
    await tx
      .update(paymentIntents)
      .set({ state: "submitted", updatedAt: at })
      .where(eq(paymentIntents.id, intent.id));
    return getIntentInTx(tx, intent.id);
  });
}

export interface BroadcastInput {
  intentId: string;
  txHash: string;
  nonceKey?: string | null;
  submittedAt?: Date;
}

/**
 * Persists the transaction identity returned by the broadcast (PLAN 6.5).
 * Repeat calls (crash between broadcast and ack) are tolerated: the intent
 * stays submitted and the attempt is journaled. This is NOT confirmation —
 * a hash alone proves nothing until reconcile.
 */
export async function markIntentBroadcast(
  db: DbOrTx,
  input: BroadcastInput,
): Promise<PaymentIntentRow> {
  return db.transaction(async (tx) => {
    const intent = await getIntentInTx(tx, input.intentId);
    if (intent.state === "confirmed") return intent;
    if (intent.state === "failed" || intent.state === "unresolved") {
      if (intent.txHash === input.txHash) return getIntentInTx(tx, intent.id);
      throw new LedgerError(
        "INTERNAL_UNEXPECTED",
        `broadcast ack conflicts with ${intent.state} intent`,
      );
    }
    const at = input.submittedAt ?? new Date();
    await tx
      .update(paymentIntents)
      .set({
        state: "submitted",
        txHash: input.txHash,
        nonceKey: input.nonceKey ?? intent.nonceKey,
        updatedAt: at,
      })
      .where(eq(paymentIntents.id, intent.id));
    await recordAttempt(tx, {
      intentId: intent.id,
      txHash: input.txHash,
      submittedAt: at,
      outcome: null,
    });
    return getIntentInTx(tx, intent.id);
  });
}

/**
 * Lost response / timeout: outcome unknown. The reservation is KEPT and the
 * known transaction identity (when the adapter could supply one) is
 * persisted so reconcileUnresolved reconciles the SAME transaction. A
 * timeout is never auto-failure (PLAN 6.6).
 */
export async function markIntentUnresolved(
  db: DbOrTx,
  input: { intentId: string; txHash: string | null; detail: string; at?: Date },
): Promise<PaymentIntentRow> {
  return db.transaction(async (tx) => {
    const intent = await getIntentInTx(tx, input.intentId);
    if (intent.state === "unresolved" || intent.state === "confirmed")
      return intent;
    if (intent.state !== "submitted") {
      throw new LedgerError(
        "INTERNAL_UNEXPECTED",
        `cannot mark ${intent.state} intent unresolved`,
      );
    }
    const at = input.at ?? new Date();
    await tx
      .update(paymentIntents)
      .set({
        state: "unresolved",
        txHash: input.txHash ?? intent.txHash,
        updatedAt: at,
      })
      .where(eq(paymentIntents.id, intent.id));
    await recordAttempt(tx, {
      intentId: intent.id,
      txHash: input.txHash,
      submittedAt: at,
      outcome: {
        status: "unresolved",
        txHash: input.txHash,
        detail: input.detail,
      },
    });
    return getIntentInTx(tx, intent.id);
  });
}

/**
 * Definitive failure (decoded protocol rejection — NOT a timeout).
 * prepared/submitted -> failed; the reservation is RELEASED (its capacity
 * returns). A definitively failed FUNDING payment moves the advance to
 * funding_failed (PLAN section 6). A failed collection leaves the advance
 * active; the next period's budget governs any retry.
 */
export async function markIntentFailed(
  db: DbOrTx,
  input: {
    intentId: string;
    reasonCode: string;
    detail?: string;
    txHash: string | null;
    at?: Date;
  },
): Promise<{ intent: PaymentIntentRow; advanceState?: string }> {
  const seed = await getIntent(db, input.intentId);
  if (!seed)
    throw new LedgerError(
      "INTERNAL_UNEXPECTED",
      `intent ${input.intentId} missing`,
    );
  return transactionWithAdvanceLock(db, seed.advanceId, async (tx) => {
    const intent = await getIntentInTx(tx, input.intentId);
    let advanceState: string | undefined;
    if (intent.state === "failed") return { intent, advanceState };
    if (intent.state !== "prepared" && intent.state !== "submitted") {
      throw new LedgerError(
        "INTERNAL_UNEXPECTED",
        `cannot fail a ${intent.state} intent`,
      );
    }
    const at = input.at ?? new Date();
    await tx
      .update(paymentIntents)
      .set({
        state: "failed",
        txHash: input.txHash ?? intent.txHash,
        updatedAt: at,
      })
      .where(eq(paymentIntents.id, intent.id));
    await recordAttempt(tx, {
      intentId: intent.id,
      txHash: input.txHash,
      submittedAt: at,
      outcome: {
        status: "failed",
        reasonCode: input.reasonCode,
        detail: input.detail,
        txHash: input.txHash,
      },
    });

    await releaseReservation(tx, intent.id, at);

    if (intent.kind === "funding") {
      const advance = await getAdvance(tx, intent.advanceId);
      if (advance && advance.state === "funding_pending") {
        await setAdvanceState(tx, advance.id, "funding_failed", { at });
        advanceState = "funding_failed";
      }
    }
    return { intent: await getIntentInTx(tx, intent.id), advanceState };
  });
}

export type ReconcileResult =
  | { kind: "applied"; intent: PaymentIntentRow; effects: string[] }
  | { kind: "already-applied"; intent: PaymentIntentRow }
  | { kind: "kept-unresolved"; intent: PaymentIntentRow }
  | { kind: "intent-failed-terminal"; intent: PaymentIntentRow }
  | { kind: "no-txhash"; intent: PaymentIntentRow };

/**
 * Reconcile-once application of a chain outcome to the ledger (PLAN 6.7).
 *
 * Money rules:
 * - The ledger effect is applied EXACTLY ONCE per (advance, kind, txHash):
 *   the partial unique index `ledger_entries_tx_once` is the arbiter. A
 *   duplicate reconcile (same txHash) finds no new ledger row and performs
 *   NO further financial mutation — it only repairs intent/reservation
 *   bookkeeping. There is no exactly-once claim across db and chain: the
 *   chain is the source of truth, the ledger applies each chain transaction
 *   once.
 * - CONFIRMED funding: disbursement ledger row (+amount); the advance moves
 *   funding_pending -> active ONLY here, and the period anchor becomes the
 *   funding confirmation time (PLAN section 3 anchoring).
 * - CONFIRMED collection: repayment ledger row (-amount) reduces the
 *   confirmed outstanding; the budget remainder is debited; the reservation
 *   is SETTLED; outstanding zero => payoff stop (repaid), including the
 *   exact final partial payment (the reservation was capped earlier, at
 *   reserve time).
 * - FAILED: reservation RELEASED; funding failure => funding_failed.
 * - UNRESOLVED/PENDING outcome: the intent stays unresolved, reservation
 *   KEPT — never auto-failure.
 *
 * A terminal `failed` intent is never resurrected by a later confirmed
 * reconcile: that situation (adapter misclassification) needs operator
 * review and is surfaced as `intent-failed-terminal`.
 */
export async function reconcileIntent(
  db: Db,
  input: { intentId: string; outcome: PaymentOutcome },
): Promise<ReconcileResult> {
  const seed = await getIntent(db, input.intentId);
  if (!seed)
    throw new LedgerError(
      "INTERNAL_UNEXPECTED",
      `intent ${input.intentId} missing`,
    );
  return transactionWithAdvanceLock(db, seed.advanceId, async (tx) => {
    const intent = await getIntentInTx(tx, input.intentId);

    if (intent.state === "confirmed") {
      return { kind: "already-applied" as const, intent };
    }
    if (intent.state === "failed") {
      return { kind: "intent-failed-terminal" as const, intent };
    }
    if (intent.state === "prepared") {
      throw new LedgerError(
        "INTERNAL_UNEXPECTED",
        "prepared intent has no known transaction to reconcile",
      );
    }

    const outcome = input.outcome;
    if (outcome.status === "unresolved" || outcome.status === "pending") {
      const at = new Date();
      if (intent.state === "submitted") {
        await tx
          .update(paymentIntents)
          .set({ state: "unresolved", updatedAt: at })
          .where(eq(paymentIntents.id, intent.id));
      }
      await attachOutcomeToAttempt(tx, intent.id, intent.txHash, outcome);
      return {
        kind: "kept-unresolved" as const,
        intent: await getIntentInTx(tx, intent.id),
      };
    }

    const txHash =
      outcome.status === "confirmed"
        ? outcome.txHash
        : (outcome.txHash ?? intent.txHash);
    if (!txHash) return { kind: "no-txhash" as const, intent };
    const at =
      outcome.status === "confirmed"
        ? new Date(outcome.confirmedAtSec * 1000)
        : new Date();

    // ---- ledger effect: apply exactly once per (advance, kind, txHash) ----
    const kind = intent.kind === "funding" ? "disbursement" : "repayment";
    const signedAmount =
      intent.kind === "funding" ? intent.amount : -intent.amount;
    const ledgerResult = await tx.execute(sql`
      insert into ledger_entries (advance_id, kind, amount, intent_id, tx_hash, effective_at)
      values (${intent.advanceId}, ${kind}, ${signedAmount}, ${intent.id}, ${txHash}, ${at.toISOString()})
      on conflict (advance_id, kind, tx_hash) where tx_hash is not null do nothing
      returning id
    `);
    const ledgerRows =
      (ledgerResult as unknown as { rows?: unknown[] }).rows ?? [];
    const ledgerInserted = ledgerRows.length > 0;

    await tx
      .update(paymentIntents)
      .set({ state: "confirmed", txHash, updatedAt: at })
      .where(eq(paymentIntents.id, intent.id));
    await attachOutcomeToAttempt(tx, intent.id, txHash, outcome);

    const effects: string[] = [];
    const reservation = await reservationForIntent(tx, intent.id);

    if (ledgerInserted) {
      effects.push(`ledger:${kind}`);
      if (intent.kind === "funding") {
        const advance = await getAdvance(tx, intent.advanceId);
        if (advance && advance.state === "funding_pending") {
          await tx
            .update(advances)
            .set({
              periodAnchor: at,
              fundingIntentId: intent.id,
              updatedAt: at,
            })
            .where(eq(advances.id, advance.id));
          await setAdvanceState(tx, advance.id, "active", { at });
          effects.push("advance:active");
        }
      } else {
        // Repayment: reduce confirmed outstanding (which derives only from
        // the reconciled ledger), debit the budget remainder, settle the
        // reservation.
        await tx
          .update(advances)
          .set({
            confirmedOutstandingAmount: sql`greatest(${advances.confirmedOutstandingAmount} - ${intent.amount}, 0)`,
            updatedAt: at,
          })
          .where(eq(advances.id, intent.advanceId));
        effects.push("outstanding:decremented");
        if (intent.budgetId) {
          await debitBudgetRemaining(tx, intent.budgetId, intent.amount);
          effects.push("budget:debited");
        }
        if (reservation && reservation.status === "held") {
          await tx
            .update(collectionReservations)
            .set({ status: "settled", updatedAt: at })
            .where(eq(collectionReservations.id, reservation.id));
          effects.push("reservation:settled");
        }
        // Payoff stop, including the exact final partial payment.
        if (await markRepaidIfSettled(tx, intent.advanceId, at)) {
          effects.push("advance:repaid");
        }
      }
    } else {
      // Duplicate reconcile of an already-applied transaction: repair
      // bookkeeping only — never a second financial mutation.
      if (
        reservation &&
        reservation.status === "held" &&
        intent.kind === "collection"
      ) {
        await tx
          .update(collectionReservations)
          .set({ status: "settled", updatedAt: at })
          .where(eq(collectionReservations.id, reservation.id));
        effects.push("reservation:repair-settled");
      }
    }

    return {
      kind: "applied" as const,
      intent: await getIntentInTx(tx, intent.id),
      effects,
    };
  });
}

/** Mission-vocabulary alias: confirmPayment == reconcileIntent with a known outcome. */
export const confirmPayment = reconcileIntent;

/**
 * Intents that are submitted but have NO txHash (crash between broadcast and
 * ack, or a lost response carrying no identity). They canNOT be reconciled
 * by hash and must never be blind-retried with a new economic payment; the
 * funding/collection jobs may re-drive them ONLY when the adapter makes
 * re-submission of the same intent nonce-safe. Surfaced for operators here.
 */
export async function findSubmittedIntentsWithoutTxHash(
  db: DbOrTx,
): Promise<PaymentIntentRow[]> {
  return db
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.state, "submitted"),
        sql`${paymentIntents.txHash} is null`,
      ),
    )
    .orderBy(paymentIntents.createdAt);
}

export async function ledgerEntriesForAdvance(db: DbOrTx, advanceId: string) {
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.advanceId, advanceId))
    .orderBy(ledgerEntries.effectiveAt);
}
