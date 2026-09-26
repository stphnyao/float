import { z } from "zod";
import { hexAddressSchema, hex32Schema, moneyAmountSchema } from "./money.js";
import { authorizationStateSchema } from "./states.js";

/**
 * One delegated access-key scope: allowed contract, function selector, and
 * (optionally) restricted recipients. The demo scope is exactly the chosen
 * token's transfer function with the treasury as sole recipient.
 */
export const accessKeyScopeSchema = z.object({
  contractAddress: hexAddressSchema,
  selector: z.string().min(1),
  recipients: z.array(hexAddressSchema),
});
export type AccessKeyScope = z.infer<typeof accessKeyScopeSchema>;

/**
 * Merchant-authorized collection authority. Root keys stay in the merchant
 * wallet; this is a dedicated delegated key per authorization, with a
 * recurring period ceiling and expiry. Chain-confirmed evidence (not
 * assumption) drives state; database payoff does NOT revoke the key.
 */
export const authorizationSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  advanceId: z.string().uuid().nullable(),
  chainId: z.number().int().positive(),
  tokenAddress: hexAddressSchema,
  /** Address/identifier of the delegated key. */
  keyAddress: z.string().min(1),
  keyPublicKey: z.string().min(1).nullable(),
  scopes: z.array(accessKeyScopeSchema).min(1),
  /** Recurring limit window in seconds (e.g. 86400); null = lifetime limit. */
  periodSeconds: z.number().int().positive().nullable(),
  periodCeilingAmount: moneyAmountSchema.nullable(),
  expirySec: z.number().int().nullable(),
  state: authorizationStateSchema,
  authorizationTxHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .nullable(),
  revokedTxHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .nullable(),
  /** Witness value whose on-chain burn invalidates the authorization (TIP-1053), if used. */
  witness: hex32Schema.nullable(),
  confirmedAtSec: z.number().int().nullable(),
  revokedConfirmedAtSec: z.number().int().nullable(),
  createdAtSec: z.number().int(),
  updatedAtSec: z.number().int(),
});
export type Authorization = z.infer<typeof authorizationSchema>;

/** Live on-chain read of an authorization, as returned by the adapter. */
export const authorizationReadSchema = z.object({
  state: authorizationStateSchema,
  /** Remaining spend allowance in the current period, base units, if the chain exposes it. */
  remainingPeriodAllowance: moneyAmountSchema.nullable(),
  /** Chain-reported period end, if exposed; persisted so app windows align with it. */
  currentPeriodEndSec: z.number().int().nullable(),
  expirySec: z.number().int().nullable(),
});
export type AuthorizationRead = z.infer<typeof authorizationReadSchema>;
