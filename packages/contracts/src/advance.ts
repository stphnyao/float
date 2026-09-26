import { z } from "zod";
import {
  moneyAmountSchema,
  basisPointsSchema,
  hexAddressSchema,
  tokenRefSchema,
} from "./money.js";
import { advanceStateSchema } from "./states.js";

/**
 * An advance binds the accepted offer terms to funding and repayment state.
 * confirmedOutstandingAmount is derived only from reconciled ledger entries —
 * one repayment per transaction, and it is the single source for budgets.
 */
export const advanceSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  offerId: z.string().uuid(),
  /** Must equal the accepted offer's termsHash. */
  termsHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  token: tokenRefSchema,
  treasuryAddress: hexAddressSchema,
  merchantAddress: hexAddressSchema,
  principalAmount: moneyAmountSchema,
  obligationAmount: moneyAmountSchema,
  collectionRateBps: basisPointsSchema,
  periodCeilingAmount: moneyAmountSchema,
  periodSeconds: z.number().int().positive(),
  state: advanceStateSchema,
  fundingIntentId: z.string().uuid().nullable(),
  confirmedOutstandingAmount: moneyAmountSchema,
  /** Period anchor = authorization/funding confirmation time. */
  periodAnchorSec: z.number().int(),
  createdAtSec: z.number().int(),
  updatedAtSec: z.number().int(),
});
export type Advance = z.infer<typeof advanceSchema>;
