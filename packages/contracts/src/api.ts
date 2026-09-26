import { z } from "zod";
import { evidenceModeSchema } from "./evidence.js";

/**
 * Reason codes are stable, prefixed, and documented. API consumers branch on
 * these, never on message text. Additions are allowed; renames are not.
 *
 * Prefixes:
 * - VALIDATION_*  request malformed
 * - AUTH_*        ownership/challenge failures
 * - OFFER_*       offer state problems
 * - ADVANCE_*     advance state problems
 * - COLLECTION_*  collection/budget/authority problems (usually -> paused)
 * - INGESTION_*   receipt pipeline problems
 */
export const REASON_CODES = [
  "VALIDATION_INVALID_REQUEST",
  "VALIDATION_MISMATCHED_IDENTITY",
  "AUTH_CHALLENGE_REQUIRED",
  "AUTH_CHALLENGE_INVALID",
  "AUTH_CHALLENGE_REPLAYED",
  "OFFER_NOT_FOUND",
  "OFFER_EXPIRED",
  "OFFER_ALREADY_DECIDED",
  "OFFER_TERMS_HASH_MISMATCH",
  "ADVANCE_ALREADY_OPEN",
  "ADVANCE_NOT_ACTIVE",
  "ADVANCE_TERMS_HASH_MISMATCH",
  "COLLECTION_AUTHORIZATION_NOT_VALID",
  "COLLECTION_AUTHORIZATION_EXPIRED",
  "COLLECTION_AUTHORIZATION_REVOKED",
  "COLLECTION_BUDGET_EXHAUSTED",
  "COLLECTION_ZERO_ELIGIBLE_RECEIPTS",
  "COLLECTION_SCAN_INCOMPLETE",
  "COLLECTION_UNRESOLVED_PAYMENT",
  "COLLECTION_WALLET_INSUFFICIENT_BALANCE",
  "COLLECTION_OUTSTANDING_CLEARED",
  "INGESTION_CURSOR_INVALID",
  "INTERNAL_UNEXPECTED",
] as const;

export const reasonCodeSchema = z.enum(REASON_CODES);
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * Uniform API envelope. Outcomes distinguish pending / confirmed / failed /
 * unresolved; a transaction hash is never presented as confirmation.
 */
export type ApiResult<T> =
  | {
      ok: true;
      data: T;
      evidenceMode: z.infer<typeof evidenceModeSchema> | null;
    }
  | {
      ok: false;
      code: ReasonCode;
      message: string;
      /** True when the underlying financial state may have changed but is not yet reconciled. */
      unresolved?: boolean;
    };

export function apiOk<T>(
  data: T,
  evidenceMode: z.infer<typeof evidenceModeSchema> | null = null,
): ApiResult<T> {
  return { ok: true, data, evidenceMode };
}

export function apiError(
  code: ReasonCode,
  message: string,
  unresolved = false,
): ApiResult<never> {
  return {
    ok: false,
    code,
    message,
    ...(unresolved ? { unresolved: true } : {}),
  };
}
