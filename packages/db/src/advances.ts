import { and, desc, eq, inArray } from "drizzle-orm";
import {
  canTransition,
  parseMoneyAmount,
  type AdvanceState,
  type OfferTerms,
} from "@float/contracts";
import type { Db } from "./client.js";
import { LedgerError, isUniqueViolation } from "./errors.js";
import {
  advances,
  authorizations,
  merchants,
  offers,
  paymentIntents,
  type advances as advancesTable,
} from "./schema.js";
import { fundingIntentKey } from "./ids.js";
import type { DbOrTx, Tx } from "./tx.js";

export type AdvanceRow = typeof advancesTable.$inferSelect;

export const OPEN_ADVANCE_STATES_DB: readonly AdvanceState[] = [
  "funding_pending",
  "active",
  "paused",
];

export async function ensureMerchant(
  db: DbOrTx,
  walletAddress: string,
): Promise<{ id: string; walletAddress: string }> {
  const inserted = await db
    .insert(merchants)
    .values({ walletAddress })
    .onConflictDoNothing({ target: merchants.walletAddress })
    .returning({ id: merchants.id, walletAddress: merchants.walletAddress });
  if (inserted[0]) return inserted[0];
  const existing = await db
    .select({ id: merchants.id, walletAddress: merchants.walletAddress })
    .from(merchants)
    .where(eq(merchants.walletAddress, walletAddress))
    .limit(1);
  const row = existing[0];
  if (!row)
    throw new LedgerError("INTERNAL_UNEXPECTED", "merchant insert failed");
  return row;
}

export async function getAdvance(
  db: DbOrTx,
  advanceId: string,
): Promise<AdvanceRow | null> {
  const rows = await db
    .select()
    .from(advances)
    .where(eq(advances.id, advanceId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAdvanceForMerchant(
  db: DbOrTx,
  merchantId: string,
): Promise<AdvanceRow[]> {
  return db
    .select()
    .from(advances)
    .where(eq(advances.merchantId, merchantId))
    .orderBy(desc(advances.createdAt));
}

/** Open advances (funding_pending/active/paused) — these hold worker attention. */
export async function listOpenAdvances(db: DbOrTx): Promise<AdvanceRow[]> {
  return db
    .select()
    .from(advances)
    .where(inArray(advances.state, [...OPEN_ADVANCE_STATES_DB]))
    .orderBy(advances.createdAt);
}

export interface AcceptOfferAuthorizationInput {
  chainId: number;
  tokenAddress: string;
  /** Merchant root chain account whose keychain holds the delegated key. */
  chainAccountAddress: string | null;
  keyAddress: string;
  keyPublicKey: string | null;
  scopes: {
    contractAddress: string;
    selector: string;
    recipients: string[];
  }[];
  periodSeconds: number | null;
  periodCeilingAmount: string | null;
  /** Unix seconds; null = lifetime limit. */
  expirySec: number | null;
  /** Chain-confirmed authorization evidence; required for funding to proceed. */
  authorizationTxHash: string | null;
  witness: string | null;
}

export interface AcceptOfferInput {
  offerId: string;
  /**
   * Client-provided terms hash. Acceptance is bound to the immutable offer
   * terms: a mismatch rejects without any financial mutation (G3 matrix:
   * auth/offer replay).
   */
  termsHash: string;
  /** Accepted-at time; also the initial period anchor until funding confirms. */
  now: Date;
  /**
   * Authenticated merchant wallet expected to own this offer. When provided,
   * a mismatch (another merchant's ID / offer theft) rejects without any
   * financial mutation (G3 matrix: auth/offer replay).
   */
  expectedMerchantWalletAddress?: string;
  authorization?: AcceptOfferAuthorizationInput;
}

export interface AcceptOfferResult {
  advance: AdvanceRow;
  fundingIntentId: string;
  /** True when a prior acceptance was replayed (existing row returned). */
  replayed: boolean;
}

async function merchantWallet(tx: Tx, merchantId: string): Promise<string> {
  const rows = await tx
    .select({ wallet: merchants.walletAddress })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  const row = rows[0];
  if (!row)
    throw new LedgerError("INTERNAL_UNEXPECTED", "offer merchant missing");
  return row.wallet;
}

async function fundingIntentIdFor(tx: Tx, advanceId: string): Promise<string> {
  const rows = await tx
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.advanceId, advanceId),
        eq(paymentIntents.kind, "funding"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row)
    throw new LedgerError("INTERNAL_UNEXPECTED", "funding intent missing");
  return row.id;
}

async function existingAcceptance(
  tx: Tx,
  offerId: string,
  termsHash: string,
): Promise<AcceptOfferResult> {
  const rows = await tx
    .select()
    .from(advances)
    .where(eq(advances.offerId, offerId))
    .limit(1);
  const existing = rows[0];
  if (!existing)
    throw new LedgerError("INTERNAL_UNEXPECTED", "advance row vanished");
  if (existing.termsHash !== termsHash) {
    throw new LedgerError(
      "VALIDATION_MISMATCHED_IDENTITY",
      "acceptance replay with a different terms hash",
    );
  }
  return {
    advance: existing,
    fundingIntentId: await fundingIntentIdFor(tx, existing.id),
    replayed: true,
  };
}

/**
 * Accept an offer and create the advance + its (single, stable-keyed) funding
 * intent in ONE transaction.
 *
 * Idempotency: the unique index `advances_offer_once` is the arbiter. A
 * duplicate acceptance with the same terms hash resolves to the existing
 * advance (replayed=true) and never creates a second advance or a second
 * funding intent. A duplicate with a MISMATCHED terms hash is rejected
 * (VALIDATION_MISMATCHED_IDENTITY) — it must never silently "succeed".
 * A different offer's acceptance while an open advance exists rejects with
 * ADVANCE_ALREADY_OPEN via the `advances_one_open_per_merchant` index.
 *
 * The advance starts in funding_pending with confirmedOutstandingAmount =
 * obligation (nothing repaid yet); only a reconciled confirmed funding
 * intent moves it to active (see payments.reconcileIntent).
 */
export async function acceptOffer(
  db: Db,
  input: AcceptOfferInput,
): Promise<AcceptOfferResult> {
  return db.transaction(async (tx) => {
    const offerRows = await tx
      .select()
      .from(offers)
      .where(eq(offers.id, input.offerId))
      .for("update")
      .limit(1);
    const offer = offerRows[0];
    if (!offer) {
      throw new LedgerError(
        "OFFER_NOT_FOUND",
        `offer ${input.offerId} not found`,
      );
    }

    // Identity binding: the authenticated wallet must own the offer.
    if (input.expectedMerchantWalletAddress) {
      const ownerWallet = await merchantWallet(tx, offer.merchantId);
      if (ownerWallet !== input.expectedMerchantWalletAddress) {
        throw new LedgerError(
          "VALIDATION_MISMATCHED_IDENTITY",
          "offer does not belong to the authenticated merchant",
        );
      }
    }

    // Replay first: an advance for this offer already exists (idempotent).
    const priorRows = await tx
      .select({ id: advances.id })
      .from(advances)
      .where(eq(advances.offerId, input.offerId))
      .limit(1);
    if (priorRows[0])
      return existingAcceptance(tx, input.offerId, input.termsHash);

    if (offer.state !== "offered") {
      throw new LedgerError(
        "OFFER_ALREADY_DECIDED",
        `offer is ${offer.state}, not offered`,
      );
    }
    if (offer.expiresAt.getTime() <= input.now.getTime()) {
      throw new LedgerError("OFFER_EXPIRED", "offer expiry has passed");
    }
    if (offer.termsHash !== input.termsHash) {
      throw new LedgerError(
        "OFFER_TERMS_HASH_MISMATCH",
        "acceptance terms hash does not match the offer terms hash",
      );
    }
    if (offer.decision !== "eligible") {
      throw new LedgerError(
        "OFFER_ALREADY_DECIDED",
        `offer decision is ${offer.decision}, not eligible`,
      );
    }

    const terms: OfferTerms = offer.terms;
    const walletAddress = await merchantWallet(tx, offer.merchantId);
    let advance: typeof advancesTable.$inferSelect;
    try {
      const inserted = await tx
        .insert(advances)
        .values({
          merchantId: offer.merchantId,
          offerId: offer.id,
          termsHash: offer.termsHash,
          tokenChainId: terms.token.chainId,
          tokenAddress: terms.token.address,
          tokenDecimals: terms.token.decimals,
          treasuryAddress: terms.treasuryAddress,
          // The merchant's chain address for collection is the wallet address
          // in this MVP (single supported wallet integration).
          merchantAddress: walletAddress,
          principalAmount: parseMoneyAmount(terms.principalAmount),
          obligationAmount: parseMoneyAmount(terms.totalObligationAmount),
          collectionRateBps: terms.collectionRateBps,
          periodCeilingAmount: parseMoneyAmount(terms.periodCeilingAmount),
          periodSeconds: terms.periodSeconds,
          state: "funding_pending",
          confirmedOutstandingAmount: parseMoneyAmount(
            terms.totalObligationAmount,
          ),
          periodAnchor: input.now,
        })
        // offer_id conflict = concurrent duplicate acceptance; the other
        // unique index (one open advance) still raises and is mapped below.
        .onConflictDoNothing({ target: advances.offerId })
        .returning();
      const row = inserted[0];
      if (!row) {
        // Lost a race to an identical acceptance: return the winner.
        return existingAcceptance(tx, input.offerId, input.termsHash);
      }
      advance = row;
    } catch (err) {
      if (isUniqueViolation(err, "advances_one_open_per_merchant")) {
        throw new LedgerError(
          "ADVANCE_ALREADY_OPEN",
          "merchant already has an open advance (one-open-advance invariant)",
        );
      }
      throw err;
    }

    // One funding intent per advance, stable idempotency key, created in the
    // same transaction as the advance. Amount = principal (treasury pays the
    // merchant); no reservation — reservations cap collections only.
    await tx
      .insert(paymentIntents)
      .values({
        kind: "funding",
        idempotencyKey: fundingIntentKey(advance.id),
        advanceId: advance.id,
        budgetId: null,
        amount: advance.principalAmount,
        state: "prepared",
        txHash: null,
        // Deterministic nonce slot for the treasury account; the live adapter
        // must make re-submission of the same intent nonce-safe.
        nonceKey: "0",
      })
      .onConflictDoNothing({ target: paymentIntents.idempotencyKey });

    if (input.authorization) {
      const auth = input.authorization;
      await tx.insert(authorizations).values({
        merchantId: offer.merchantId,
        advanceId: advance.id,
        chainId: auth.chainId,
        tokenAddress: auth.tokenAddress,
        keyAddress: auth.keyAddress,
        keyPublicKey: auth.keyPublicKey,
        scopes: auth.scopes,
        periodSeconds: auth.periodSeconds,
        periodCeilingAmount:
          auth.periodCeilingAmount === null
            ? null
            : parseMoneyAmount(auth.periodCeilingAmount),
        expiresAt:
          auth.expirySec === null ? null : new Date(auth.expirySec * 1000),
        state: auth.authorizationTxHash ? "valid" : "pending",
        authorizationTxHash: auth.authorizationTxHash,
        revokedTxHash: null,
        witness: auth.witness,
        confirmedAt: auth.authorizationTxHash ? input.now : null,
      });
    }

    return {
      advance,
      fundingIntentId: await fundingIntentIdFor(tx, advance.id),
      replayed: false,
    };
  });
}

/**
 * Applies a state transition validated against contracts' STATE_TRANSITIONS.
 * `pauseReasonCode` is stored only for pauses (accurate reason requirement);
 * resume clears it. Returns false when the transition is a no-op (already in
 * the requested state with the same reason).
 */
export async function setAdvanceState(
  tx: Tx,
  advanceId: string,
  to: AdvanceState,
  opts: { pauseReasonCode?: string | null; at?: Date } = {},
): Promise<boolean> {
  const current = await getAdvance(tx, advanceId);
  if (!current) throw new LedgerError("INTERNAL_UNEXPECTED", "advance missing");
  if (current.state === to) {
    if (to !== "paused") return false;
    if ((current.pauseReasonCode ?? null) === (opts.pauseReasonCode ?? null)) {
      return false;
    }
    // Same state, updated reason: allowed (keeps reporting accurate).
  } else if (!canTransition("advance", current.state, to)) {
    throw new LedgerError(
      "ADVANCE_NOT_ACTIVE",
      `illegal advance transition ${current.state} -> ${to}`,
    );
  }
  const at = opts.at ?? new Date();
  const patch: Partial<typeof advances.$inferInsert> = {
    state: to,
    updatedAt: at,
  };
  if (to === "paused") {
    patch.pauseReasonCode = opts.pauseReasonCode ?? null;
    patch.pausedAt = current.state === "paused" ? current.pausedAt : at;
  }
  if (current.state === "paused" && to !== "paused") {
    patch.pauseReasonCode = null;
    patch.pausedAt = null;
  }
  await tx.update(advances).set(patch).where(eq(advances.id, advanceId));
  return true;
}

/**
 * Payoff stop (PLAN 6.9): once confirmed outstanding reaches zero the
 * advance must end at repaid. A paused advance transitions paused -> active
 * -> repaid (both are legal transitions); called after a repayment ledger
 * application inside the reconcile transaction.
 */
export async function markRepaidIfSettled(
  tx: Tx,
  advanceId: string,
  at: Date,
): Promise<boolean> {
  const current = await getAdvance(tx, advanceId);
  if (!current || current.confirmedOutstandingAmount !== 0n) return false;
  if (current.state === "repaid") return false;
  if (current.state === "paused") {
    await setAdvanceState(tx, advanceId, "active", { at });
  }
  const refreshed = await getAdvance(tx, advanceId);
  if (refreshed?.state === "active") {
    await setAdvanceState(tx, advanceId, "repaid", { at });
    return true;
  }
  return false;
}
