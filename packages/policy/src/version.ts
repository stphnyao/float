/**
 * Policy v1 constants. Every threshold here is frozen in docs/policy-v1.md
 * BEFORE implementation (PLAN.md section 4). A v2 must bump POLICY_VERSION and
 * re-freeze a new document; thresholds are integers, never floats.
 */
export const POLICY_VERSION = "policy-v1";

/** Normal periods are 86,400 seconds anchored to authorization time (PLAN section 3). */
export const DEFAULT_PERIOD_SECONDS = 86400;

/** Minimum number of complete windows in the evaluation series. */
export const MIN_COMPLETE_WINDOWS = 21;

/** Minimum number of complete windows with positive eligible receipts (active periods). */
export const MIN_ACTIVE_PERIODS = 15;

/** Minimum total eligible volume, in whole token units (scaled by verified decimals). */
export const MIN_ELIGIBLE_VOLUME_WHOLE_UNITS = 300;

/** Maximum top-payer share of included eligible volume, in basis points (60%). */
export const MAX_TOP_PAYER_SHARE_BPS = 6000;

/**
 * Maximum volatility, in basis points: max active-day eligible receipts may
 * not exceed 2.5x the mean active-day receipts (over complete windows).
 */
export const MAX_ACTIVE_DAY_VOLATILITY_BPS = 25000;

/** Conservative baseline percentile: P25 of complete-window observations including zero-sales days. */
export const BASELINE_PERCENTILE_BPS = 2500;

/** Forecast horizon in collection periods (14 x 86,400 s). */
export const FORECAST_HORIZON_PERIODS = 14;

/** Haircut applied to collection capacity when sizing principal (50%). */
export const SIZING_HAIRCUT_BPS = 5000;

/** Default collection rate: 10.00% of eligible receipts. */
export const DEFAULT_COLLECTION_RATE_BPS = 1000;

/** Default per-period collection ceiling, in whole token units. */
export const DEFAULT_PERIOD_CEILING_WHOLE_UNITS = 100;

/** Absolute demo maximum principal, in whole token units. */
export const MAX_PRINCIPAL_WHOLE_UNITS = 500;

/**
 * Scales whole token units to integer base units using verified decimals.
 * Integer math only: 10^decimals as BigInt power.
 */
export function wholeUnitsToBaseUnits(
  wholeUnits: number | bigint,
  decimals: number,
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(
      `token decimals must be a non-negative integer (got ${decimals})`,
    );
  }
  const whole = BigInt(wholeUnits);
  if (whole < 0n) throw new Error("whole units must be non-negative");
  return whole * 10n ** BigInt(decimals);
}

/**
 * Stable policy reason codes (docs/policy-v1.md section 8). Additions are
 * allowed; renames are not. These are policy-local codes surfaced verbatim in
 * Offer.reasonCodes; they are distinct from the API-level REASON_CODES in
 * packages/contracts.
 */
export const POLICY_REASON_CODES = [
  // classification-level
  "policy_included_eligible_sale",
  "policy_excluded_duplicate_event",
  "policy_excluded_untracked_token",
  "policy_excluded_unrelated_transfer",
  "policy_excluded_self_transfer",
  "policy_excluded_faucet_distribution",
  "policy_excluded_float_disbursement",
  "policy_excluded_known_self_funding",
  "policy_excluded_identified_non_sale",
  "policy_excluded_outgoing_transfer",
  "policy_excluded_suspected_circular",
  "policy_adjustment_refund",
  // decision-level
  "policy_no_snapshots",
  "policy_history_incomplete",
  "policy_insufficient_history_windows",
  "policy_insufficient_history_active_periods",
  "policy_no_eligible_receipts",
  "policy_eligible_volume_below_minimum",
  "policy_payer_concentration_above_cap",
  "policy_volatility_above_cap",
  "policy_suspicious_flow_detected",
  "policy_meets_all_thresholds",
  "policy_mixed_evidence_modes",
  "policy_not_sized_non_eligible_decision",
] as const;

export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

/**
 * Frozen order in which decision-level reason codes accumulate (docs/
 * policy-v1.md section 5). Codes absent from this list keep insertion order.
 */
export const POLICY_DECISION_REASON_ORDER = [
  "policy_history_incomplete",
  "policy_insufficient_history_windows",
  "policy_insufficient_history_active_periods",
  "policy_no_eligible_receipts",
  "policy_eligible_volume_below_minimum",
  "policy_payer_concentration_above_cap",
  "policy_volatility_above_cap",
  "policy_suspicious_flow_detected",
] as const;

/** Decision-level codes that map to `insufficient_evidence` (evidence adequacy). */
export const INSUFFICIENT_EVIDENCE_CODES: ReadonlySet<string> = new Set([
  "policy_no_snapshots",
  "policy_history_incomplete",
  "policy_insufficient_history_windows",
  "policy_insufficient_history_active_periods",
  "policy_no_eligible_receipts",
]);

/** Decision-level codes that map to `declined` (quality failures). */
export const DECLINED_CODES: ReadonlySet<string> = new Set([
  "policy_eligible_volume_below_minimum",
  "policy_payer_concentration_above_cap",
  "policy_volatility_above_cap",
  "policy_suspicious_flow_detected",
]);
