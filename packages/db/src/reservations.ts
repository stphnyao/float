import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { LedgerError } from "./errors.js";
import { collectionIntentKey } from "./ids.js";
import {
  advances,
  collectionBudgets,
  collectionReservations,
  paymentIntents,
  type collectionReservations as reservationsTable,
  type paymentIntents as intentsTable,
} from "./schema.js";
import { getAdvance } from "./advances.js";
import { getActiveBudgetContaining } from "./budgets.js";
import { transactionWithAdvanceLock, type DbOrTx, type Tx } from "./tx.js";

export type ReservationRow = typeof reservationsTable.$inferSelect;
export type PaymentIntentRow = typeof intentsTable.$inferSelect;

/**
 * Remainders for one advance's CURRENT active budget (PLAN section 3):
 * - budgetRemainder  = budget.remainingAmount (budget minus CONFIRMED
 *   collections debited at reconcile) minus held (unresolved) reservations
 *   on that same budget;
 * - outstandingRemainder = confirmedOutstandingAmount (derived only from the
 *   reconciled ledger) minus ALL held reservations for the advance, whatever
 *   budget they came from (a reservation held across a period rollover still
 *   caps the debt).
 * A new payment must be capped by BOTH remainders.
 */
export interface CollectionRemainders {
  budgetId: string | null;
  budgetRemainingAmount: bigint;
  heldOnBudget: bigint;
  budgetRemainder: bigint;
  confirmedOutstandingAmount: bigint;
  heldTotal: bigint;
  outstandingRemainder: bigint;
  /** min(budgetRemainder, outstandingRemainder), floored at zero. */
  cap: bigint;
}

async function heldReservationsTotal(
  tx: Tx,
  advanceId: string,
): Promise<bigint> {
  const rows = await tx
    .select({
      total: sql<string>`coalesce(sum(${collectionReservations.amount}), 0)`,
    })
    .from(collectionReservations)
    .where(
      and(
        eq(collectionReservations.advanceId, advanceId),
        eq(collectionReservations.status, "held"),
      ),
    );
  return BigInt(rows[0]?.total ?? "0");
}

async function heldReservationsOnBudget(
  tx: Tx,
  budgetId: string,
): Promise<bigint> {
  const rows = await tx
    .select({
      total: sql<string>`coalesce(sum(${collectionReservations.amount}), 0)`,
    })
    .from(collectionReservations)
    .where(
      and(
        eq(collectionReservations.budgetId, budgetId),
        eq(collectionReservations.status, "held"),
      ),
    );
  return BigInt(rows[0]?.total ?? "0");
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a <= b ? a : b;
}

function nonNegative(v: bigint): bigint {
  return v > 0n ? v : 0n;
}

/**
 * Read-only remainder computation. Must be called inside a transaction that
 * holds the per-advance advisory lock for money decisions;
 * `computeCollectionAllowance` is the unlocked variant for worker pre-reads
 * (its result is advisory only — reserveForCollection re-clamps under lock).
 */
export async function computeRemainders(
  tx: Tx,
  advanceId: string,
  at: Date,
): Promise<CollectionRemainders> {
  const advance = await getAdvance(tx, advanceId);
  if (!advance) throw new LedgerError("INTERNAL_UNEXPECTED", "advance missing");
  const budget = await getActiveBudgetContaining(tx, advanceId, at);
  const heldTotal = await heldReservationsTotal(tx, advanceId);
  const heldOnBudget = budget
    ? await heldReservationsOnBudget(tx, budget.id)
    : 0n;
  const budgetRemainder = budget
    ? nonNegative(budget.remainingAmount - heldOnBudget)
    : 0n;
  const outstandingRemainder = nonNegative(
    advance.confirmedOutstandingAmount - heldTotal,
  );
  return {
    budgetId: budget?.id ?? null,
    budgetRemainingAmount: budget?.remainingAmount ?? 0n,
    heldOnBudget,
    budgetRemainder,
    confirmedOutstandingAmount: advance.confirmedOutstandingAmount,
    heldTotal,
    outstandingRemainder,
    cap: minBigInt(budgetRemainder, outstandingRemainder),
  };
}

/** Unlocked, best-effort allowance for worker pre-reads (never a money decision). */
export async function computeCollectionAllowance(
  db: DbOrTx,
  advanceId: string,
  at: Date,
): Promise<CollectionRemainders> {
  return db.transaction((tx) => computeRemainders(tx, advanceId, at));
}

export type ReserveOutcome =
  | {
      kind: "reserved";
      intent: PaymentIntentRow;
      reservation: ReservationRow;
      /** Final amount after capping (<= requested). */
      amount: bigint;
    }
  | {
      kind: "existing";
      intent: PaymentIntentRow;
      reservation: ReservationRow | null;
    }
  | {
      kind: "skipped";
      reason:
        | "ADVANCE_NOT_ACTIVE"
        | "NO_ACTIVE_BUDGET"
        | "UNRESOLVED_BLOCK"
        | "BUDGET_EXHAUSTED"
        | "OUTSTANDING_CLEARED";
      detail: string;
    };

export interface ReserveForCollectionInput {
  advanceId: string;
  /** The active budget this payment draws from. */
  budgetId: string;
  requestedAmount: bigint;
  /** Stable business idempotency key (see ids.collectionIntentKey). */
  idempotencyKey: string;
  now: Date;
}

/**
 * Reserves part of a collection budget for ONE payment, holding the
 * per-advance advisory lock for the whole transaction (PLAN section 3).
 *
 * Within the single lock scope this function:
 *   1. rejects when the advance is not active;
 *   2. rejects when there is no active budget for `now`;
 *   3. BLOCKS when an unresolved (or in-flight submitted) intent exists for
 *      the advance — an unknown-outcome transaction blocks new collection
 *      until reconciled, across period boundaries;
 *   4. returns the EXISTING intent for a duplicate idempotency key
 *      (duplicate/concurrent job triggers never double-reserve);
 *   5. caps the payment by BOTH remainders — budget remainder and
 *      outstanding remainder — so an over-collection reservation (e.g. the
 *      final partial payment) is capped earlier, here, before broadcast;
 *   6. inserts the payment intent (stable key) AND the held reservation
 *      BEFORE any broadcast happens (broadcast is the worker's job AFTER
 *      this transaction commits).
 *
 * Zero requested/zero cap => no intent. Never throws for the "nothing to
 * do" cases; those come back as `skipped` with a reason.
 */
export async function reserveForCollection(
  db: Db,
  input: ReserveForCollectionInput,
): Promise<ReserveOutcome> {
  return transactionWithAdvanceLock(db, input.advanceId, async (tx) => {
    const advance = await getAdvance(tx, input.advanceId);
    if (!advance)
      throw new LedgerError("INTERNAL_UNEXPECTED", "advance missing");
    if (advance.state !== "active") {
      return {
        kind: "skipped" as const,
        reason: "ADVANCE_NOT_ACTIVE" as const,
        detail: `advance state is ${advance.state}`,
      };
    }

    // Idempotency first: a duplicate trigger resolves to the existing intent.
    const existingIntentRows = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.idempotencyKey, input.idempotencyKey))
      .limit(1);
    const existingIntent = existingIntentRows[0];
    if (existingIntent) {
      const existingReservation = await reservationForIntent(
        tx,
        existingIntent.id,
      );
      return {
        kind: "existing" as const,
        intent: existingIntent,
        reservation: existingReservation,
      };
    }

    // Unresolved transactions block new collection for this advance.
    const inFlight = await tx
      .select({
        id: paymentIntents.id,
        state: paymentIntents.state,
        kind: paymentIntents.kind,
      })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.advanceId, input.advanceId),
          inArray(paymentIntents.state, ["submitted", "unresolved"]),
        ),
      )
      .limit(1);
    if (inFlight[0]) {
      return {
        kind: "skipped" as const,
        reason: "UNRESOLVED_BLOCK" as const,
        detail: `intent ${inFlight[0].id} is ${inFlight[0].state}; reconcile before new collection`,
      };
    }

    const budgetRows = await tx
      .select()
      .from(collectionBudgets)
      .where(eq(collectionBudgets.id, input.budgetId))
      .limit(1);
    const budget = budgetRows[0];
    if (
      !budget ||
      budget.advanceId !== input.advanceId ||
      budget.status !== "active" ||
      budget.periodStart > input.now ||
      budget.periodEnd <= input.now
    ) {
      return {
        kind: "skipped" as const,
        reason: "NO_ACTIVE_BUDGET" as const,
        detail: `budget ${input.budgetId} is not active for now`,
      };
    }

    const remainders = await computeRemainders(tx, input.advanceId, input.now);
    const amount = minBigInt(
      nonNegative(input.requestedAmount),
      minBigInt(remainders.budgetRemainder, remainders.outstandingRemainder),
    );
    if (amount <= 0n) {
      // Zero eligible receipts (zero budget) and/or outstanding already
      // covered: no intent, no reservation, no transaction.
      return {
        kind: "skipped" as const,
        reason:
          remainders.budgetRemainder <= 0n
            ? "BUDGET_EXHAUSTED"
            : "OUTSTANDING_CLEARED",
        detail: `budgetRemainder=${remainders.budgetRemainder} outstandingRemainder=${remainders.outstandingRemainder}`,
      };
    }

    const insertedIntent = await tx
      .insert(paymentIntents)
      .values({
        kind: "collection",
        idempotencyKey: input.idempotencyKey,
        advanceId: input.advanceId,
        budgetId: budget.id,
        amount,
        state: "prepared",
        txHash: null,
        nonceKey: budget.periodStart.getTime().toString(),
      })
      .onConflictDoNothing({ target: paymentIntents.idempotencyKey })
      .returning();
    const intent = insertedIntent[0];
    if (!intent) {
      // Concurrent insert with the same key won; return the winner.
      const winnerRows = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.idempotencyKey, input.idempotencyKey))
        .limit(1);
      const winner = winnerRows[0];
      if (!winner)
        throw new LedgerError("INTERNAL_UNEXPECTED", "intent insert failed");
      return {
        kind: "existing" as const,
        intent: winner,
        reservation: await reservationForIntent(tx, winner.id),
      };
    }

    // Reservation held BEFORE any broadcast; it caps budget and outstanding
    // until reconcile settles (confirmed) or releases (failed) it.
    const insertedReservation = await tx
      .insert(collectionReservations)
      .values({
        advanceId: input.advanceId,
        budgetId: budget.id,
        intentId: intent.id,
        amount,
        status: "held",
      })
      .returning();
    const reservation = insertedReservation[0];
    if (!reservation)
      throw new LedgerError("INTERNAL_UNEXPECTED", "reservation insert failed");

    return { kind: "reserved" as const, intent, reservation, amount };
  });
}

export async function reservationForIntent(
  db: DbOrTx,
  intentId: string,
): Promise<ReservationRow | null> {
  const rows = await db
    .select()
    .from(collectionReservations)
    .where(eq(collectionReservations.intentId, intentId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getIntent(
  db: DbOrTx,
  intentId: string,
): Promise<PaymentIntentRow | null> {
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, intentId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getIntentByIdempotencyKey(
  db: DbOrTx,
  idempotencyKey: string,
): Promise<PaymentIntentRow | null> {
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.idempotencyKey, idempotencyKey))
    .limit(1);
  return rows[0] ?? null;
}

/** Intents with an unknown outcome and a known transaction identity to reconcile. */
export async function findReconcilableIntents(
  db: DbOrTx,
): Promise<PaymentIntentRow[]> {
  return db
    .select()
    .from(paymentIntents)
    .where(
      and(
        inArray(paymentIntents.state, ["submitted", "unresolved"]),
        sql`${paymentIntents.txHash} is not null`,
      ),
    )
    .orderBy(paymentIntents.createdAt);
}

/** True when the advance still has an intent whose outcome is unknown. */
export async function hasBlockingIntent(
  db: DbOrTx,
  advanceId: string,
  kinds: ("unresolved" | "submitted")[] = ["unresolved"],
): Promise<boolean> {
  const states = kinds;
  const rows = await db
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.advanceId, advanceId),
        inArray(paymentIntents.state, states),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export { collectionIntentKey };
