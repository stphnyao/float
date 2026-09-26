/**
 * Float policy v1 (work package C). Deterministic receipt classification,
 * snapshot building, eligibility evaluation, and offer sizing for the demo.
 * Thresholds and score direction are frozen in docs/policy-v1.md; this
 * package implements that document. Pure functions only: no I/O, no chain
 * calls, no randomness, no clock.
 */
export {
  POLICY_VERSION,
  DEFAULT_PERIOD_SECONDS,
  MIN_COMPLETE_WINDOWS,
  MIN_ACTIVE_PERIODS,
  MIN_ELIGIBLE_VOLUME_WHOLE_UNITS,
  MAX_TOP_PAYER_SHARE_BPS,
  MAX_ACTIVE_DAY_VOLATILITY_BPS,
  BASELINE_PERCENTILE_BPS,
  FORECAST_HORIZON_PERIODS,
  SIZING_HAIRCUT_BPS,
  DEFAULT_COLLECTION_RATE_BPS,
  DEFAULT_PERIOD_CEILING_WHOLE_UNITS,
  MAX_PRINCIPAL_WHOLE_UNITS,
  POLICY_REASON_CODES,
  POLICY_DECISION_REASON_ORDER,
  INSUFFICIENT_EVIDENCE_CODES,
  DECLINED_CODES,
  wholeUnitsToBaseUnits,
} from "./version.js";
export type { PolicyReasonCode } from "./version.js";

export * from "./periods.js";
export * from "./hash.js";
export * from "./classify.js";
export * from "./baseline.js";
export * from "./snapshots.js";
export * from "./eligibility.js";
export * from "./sizing.js";

export type { RevenueSnapshot, OfferDecision } from "@float/contracts";
