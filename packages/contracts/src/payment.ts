import { z } from "zod";
import { hexAddressSchema, moneyAmountSchema } from "./money.js";
import {
  paymentIntentKindSchema,
  paymentIntentStateSchema,
  reservationStatusSchema,
} from "./states.js";

/**
 * A payment intent is the durable unit of economic action (one disbursement
 * or one collection). The idempotency key is a stable business key (e.g.
 * advance+period) so duplicate jobs or retries can never create a second
 * economic payment. Attempts belong to exactly one intent.
 */
export const paymentIntentSchema = z.object({
  id: z.string().uuid(),
  kind: paymentIntentKindSchema,
  idempotencyKey: z.string().min(1),
  advanceId: z.string().uuid(),
  budgetId: z.string().uuid().nullable(),
  amount: moneyAmountSchema,
  state: paymentIntentStateSchema,
  /** Identity persisted BEFORE broadcast; a hash alone is not confirmation. */
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .nullable(),
  nonceKey: z.string().regex(/^\d+$/).nullable(),
  createdAtSec: z.number().int(),
  updatedAtSec: z.number().int(),
});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

/**
 * Outcome of a chain interaction. `unresolved` means we do not know the
 * outcome (timeout, lost response): the reservation is retained and the
 * known transaction is reconciled — never blindly replaced.
 */
export const paymentOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pending"),
    detail: z.string().optional(),
  }),
  z.object({
    status: z.literal("confirmed"),
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    blockNumber: z.number().int().nonnegative(),
    confirmedAtSec: z.number().int(),
    feeAmount: moneyAmountSchema.optional(),
    feePayer: z.string().optional(),
    /** TIP-20 fee token charged (Tempo has no native gas token). */
    feeToken: hexAddressSchema.optional(),
  }),
  z.object({
    status: z.literal("failed"),
    reasonCode: z.string().min(1),
    detail: z.string().optional(),
    txHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .nullable(),
  }),
  z.object({
    status: z.literal("unresolved"),
    txHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .nullable(),
    detail: z.string().min(1),
  }),
]);
export type PaymentOutcome = z.infer<typeof paymentOutcomeSchema>;

/** One broadcast attempt of an intent. */
export const paymentAttemptSchema = z.object({
  id: z.string().uuid(),
  intentId: z.string().uuid(),
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .nullable(),
  submittedAtSec: z.number().int().nullable(),
  outcome: paymentOutcomeSchema.nullable(),
  createdAtSec: z.number().int(),
});
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

/**
 * Budget reservation held while an attempt is in flight. An unresolved
 * transaction keeps its reservation across period boundaries until
 * reconciled; reservations cap both budget and outstanding debt.
 */
export const reservationSchema = z.object({
  id: z.string().uuid(),
  advanceId: z.string().uuid(),
  budgetId: z.string().uuid().nullable(),
  intentId: z.string().uuid(),
  amount: moneyAmountSchema,
  status: reservationStatusSchema,
  createdAtSec: z.number().int(),
  updatedAtSec: z.number().int(),
});
export type Reservation = z.infer<typeof reservationSchema>;
