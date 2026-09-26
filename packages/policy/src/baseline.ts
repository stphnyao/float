import { parseMoneyAmount, type RevenueSnapshot } from "@float/contracts";
import { BASELINE_PERCENTILE_BPS } from "./version.js";

/**
 * Conservative receipt baseline (docs/policy-v1.md section 7): the P25 of
 * per-window max(0, netEligibleAmount) over COMPLETE windows, ascending sort,
 * index floor((n-1) * percentile_bps / 10000), including zero-sales days.
 * Incomplete windows are excluded entirely. Integer math only.
 */
export const BASELINE_METHOD = "p25_of_complete_windows_incl_zero_days";

export interface ConservativeBaseline {
  valueBaseUnits: bigint;
  observationCount: number;
  percentileBps: number;
  method: string;
  /** Ascending clamped observations (zero-sales days included). */
  observationsBaseUnits: string[];
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function computeConservativeBaseline(
  snapshots: RevenueSnapshot[],
): ConservativeBaseline {
  const observations = snapshots
    .filter((snapshot) => snapshot.completeness === "complete")
    .map((snapshot) => {
      const value = parseMoneyAmount(snapshot.netEligibleAmount);
      return value < 0n ? 0n : value;
    })
    .sort(compareBigInt);

  if (observations.length === 0) {
    return {
      valueBaseUnits: 0n,
      observationCount: 0,
      percentileBps: BASELINE_PERCENTILE_BPS,
      method: BASELINE_METHOD,
      observationsBaseUnits: [],
    };
  }

  const index = Math.floor(
    ((observations.length - 1) * BASELINE_PERCENTILE_BPS) / 10000,
  );
  const value = observations[index] ?? 0n;
  return {
    valueBaseUnits: value,
    observationCount: observations.length,
    percentileBps: BASELINE_PERCENTILE_BPS,
    method: BASELINE_METHOD,
    observationsBaseUnits: observations.map((v) => v.toString(10)),
  };
}
