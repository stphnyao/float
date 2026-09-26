import type { RevenueWindow } from "@float/contracts";
import { DEFAULT_PERIOD_SECONDS } from "./version.js";

/**
 * Period/window helpers anchored to a provided anchor timestamp (PLAN section
 * 3). Windows are half-open [startSec, endSec). All values are integers;
 * window arithmetic uses floor division so timestamps before the anchor
 * produce correctly negative window indices.
 */
export interface CoverageRange {
  startSec: number;
  endSec: number;
}

export function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer (got ${value})`);
  }
}

/** Integer floor division, correct for negative numerators. */
export function floorDiv(numerator: number, denominator: number): number {
  assertInteger(numerator, "floorDiv numerator");
  assertInteger(denominator, "floorDiv denominator");
  if (denominator === 0)
    throw new Error("floorDiv denominator must not be zero");
  const quotient = Math.trunc(numerator / denominator);
  const hasRemainder = numerator % denominator !== 0;
  const signsDiffer = numerator < 0 !== denominator < 0;
  return hasRemainder && signsDiffer ? quotient - 1 : quotient;
}

/** Window index k such that window k = [anchor + k*P, anchor + (k+1)*P). */
export function windowIndexForTimestamp(
  anchorSec: number,
  periodSeconds: number,
  timestampSec: number,
): number {
  assertInteger(anchorSec, "anchorSec");
  assertInteger(periodSeconds, "periodSeconds");
  if (periodSeconds <= 0) throw new Error("periodSeconds must be positive");
  assertInteger(timestampSec, "timestampSec");
  return floorDiv(timestampSec - anchorSec, periodSeconds);
}

export function windowForIndex(
  anchorSec: number,
  periodSeconds: number,
  index: number,
): RevenueWindow {
  assertInteger(anchorSec, "anchorSec");
  assertInteger(periodSeconds, "periodSeconds");
  if (periodSeconds <= 0) throw new Error("periodSeconds must be positive");
  assertInteger(index, "index");
  const startSec = anchorSec + index * periodSeconds;
  return { startSec, endSec: startSec + periodSeconds };
}

export function windowForTimestamp(
  anchorSec: number,
  periodSeconds: number,
  timestampSec: number,
): RevenueWindow {
  return windowForIndex(
    anchorSec,
    periodSeconds,
    windowIndexForTimestamp(anchorSec, periodSeconds, timestampSec),
  );
}

/**
 * Merges scan-coverage ranges into a sorted, gap-free union so window
 * completeness can be checked with a simple containment test. Deterministic.
 */
export function mergeCoverage(ranges: CoverageRange[]): CoverageRange[] {
  const sorted = [...ranges].sort(
    (a, b) => a.startSec - b.startSec || a.endSec - b.endSec,
  );
  const merged: CoverageRange[] = [];
  for (const range of sorted) {
    if (range.endSec < range.startSec) {
      throw new Error("coverage range endSec must be >= startSec");
    }
    const last = merged[merged.length - 1];
    if (last && range.startSec <= last.endSec) {
      if (range.endSec > last.endSec) last.endSec = range.endSec;
    } else {
      merged.push({ startSec: range.startSec, endSec: range.endSec });
    }
  }
  return merged;
}

/** True iff every second of the window lies inside the merged coverage. */
export function coverageCoversWindow(
  merged: CoverageRange[],
  window: RevenueWindow,
): boolean {
  return merged.some(
    (r) => r.startSec <= window.startSec && r.endSec >= window.endSec,
  );
}
