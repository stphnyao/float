import { z } from "zod";

/** Offer lifecycle (PLAN.md section 6). */
export const offerStateSchema = z.enum([
  "offered",
  "accepted",
  "expired",
  "declined",
]);
export type OfferState = z.infer<typeof offerStateSchema>;

/**
 * Advance lifecycle. Open advances occupy the merchant's one-open-advance
 * slot: funding_pending, active, paused. Definitive failed funding becomes
 * funding_failed; only reconciled full repayment reaches repaid.
 */
export const advanceStateSchema = z.enum([
  "funding_pending",
  "active",
  "paused",
  "repaid",
  "funding_failed",
]);
export type AdvanceState = z.infer<typeof advanceStateSchema>;

/** States that hold the one-open-advance slot (database enforces uniqueness over these). */
export const OPEN_ADVANCE_STATES: readonly AdvanceState[] = [
  "funding_pending",
  "active",
  "paused",
] as const;

/** Authorization state is independent of advance state. */
export const authorizationStateSchema = z.enum([
  "pending",
  "valid",
  "expired",
  "revoked",
  "invalid",
]);
export type AuthorizationState = z.infer<typeof authorizationStateSchema>;

/**
 * Payment intent lifecycle. Unknown outcomes stay `unresolved` and keep their
 * reservation until reconciled; a lost response never becomes a new payment.
 */
export const paymentIntentStateSchema = z.enum([
  "prepared",
  "submitted",
  "confirmed",
  "failed",
  "unresolved",
]);
export type PaymentIntentState = z.infer<typeof paymentIntentStateSchema>;

export const paymentIntentKindSchema = z.enum(["funding", "collection"]);
export type PaymentIntentKind = z.infer<typeof paymentIntentKindSchema>;

export const reservationStatusSchema = z.enum(["held", "settled", "released"]);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

export const ledgerEntryKindSchema = z.enum([
  "disbursement",
  "repayment",
  "adjustment",
]);
export type LedgerEntryKind = z.infer<typeof ledgerEntryKindSchema>;

export const budgetStatusSchema = z.enum(["active", "exhausted", "superseded"]);
export type BudgetStatus = z.infer<typeof budgetStatusSchema>;

/**
 * Allowed state transitions. Anything not listed is rejected; persistence
 * layers must enforce the same table.
 */
export const STATE_TRANSITIONS: {
  offer: Record<OfferState, readonly OfferState[]>;
  advance: Record<AdvanceState, readonly AdvanceState[]>;
  authorization: Record<AuthorizationState, readonly AuthorizationState[]>;
  paymentIntent: Record<PaymentIntentState, readonly PaymentIntentState[]>;
} = {
  offer: {
    offered: ["accepted", "expired", "declined"],
    accepted: [],
    expired: [],
    declined: [],
  },
  advance: {
    funding_pending: ["active", "funding_failed"],
    active: ["paused", "repaid"],
    paused: ["active"],
    repaid: [],
    funding_failed: [],
  },
  authorization: {
    pending: ["valid", "invalid"],
    valid: ["expired", "revoked", "invalid"],
    expired: [],
    revoked: [],
    invalid: [],
  },
  paymentIntent: {
    prepared: ["submitted", "failed"],
    submitted: ["confirmed", "failed", "unresolved"],
    confirmed: [],
    failed: [],
    unresolved: ["confirmed", "failed"],
  },
};

export function canTransition<K extends keyof typeof STATE_TRANSITIONS>(
  kind: K,
  from: keyof (typeof STATE_TRANSITIONS)[K],
  to: keyof (typeof STATE_TRANSITIONS)[K],
): boolean {
  const table = STATE_TRANSITIONS[kind] as Record<
    string | number,
    readonly string[]
  >;
  const allowed = table[from as string] ?? [];
  return allowed.includes(to as string);
}
