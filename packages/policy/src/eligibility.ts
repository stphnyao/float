import {
  parseMoneyAmount,
  formatMoneyAmount,
  type EvidenceMode,
  type HexAddress,
  type MoneyAmount,
  type OfferDecision,
  type RevenueSnapshot,
} from "@float/contracts";
import type { ClassifiedEvent } from "./classify.js";
import { eventRefKey } from "./classify.js";
import { computeConservativeBaseline } from "./baseline.js";
import {
  DECLINED_CODES,
  INSUFFICIENT_EVIDENCE_CODES,
  MAX_ACTIVE_DAY_VOLATILITY_BPS,
  MAX_TOP_PAYER_SHARE_BPS,
  MIN_ACTIVE_PERIODS,
  MIN_COMPLETE_WINDOWS,
  MIN_ELIGIBLE_VOLUME_WHOLE_UNITS,
  POLICY_DECISION_REASON_ORDER,
  POLICY_VERSION,
  wholeUnitsToBaseUnits,
  type PolicyReasonCode,
} from "./version.js";

/**
 * Eligibility evaluation (docs/policy-v1.md section 5). Deterministic,
 * integer-only decision over a snapshot series. Insufficient evidence wins
 * over declined; all triggered reason codes are returned in the frozen order.
 * No output is a probability of default.
 */
export interface EligibilityInput {
  snapshots: RevenueSnapshot[];
  /** Classified events used to build the snapshots (for payer grouping). */
  classified: ClassifiedEvent[];
  /** Verified token decimals (adapter-verified, never assumed). */
  tokenDecimals: number;
  /**
   * Declared evidence mode of this evaluation. Must match every snapshot;
   * required so even an empty series carries its mode explicitly (never
   * silently combined, never guessed).
   */
  evidenceMode: EvidenceMode;
}

export interface EligibilityMetrics {
  completeWindows: number;
  activePeriods: number;
  incompleteWindows: number;
  totalEligibleBaseUnits: MoneyAmount;
  topPayerAddress: HexAddress | null;
  topPayerShareBps: number;
  volatilityBps: number;
  baselineBaseUnits: MoneyAmount;
  baselineObservations: number;
}

export interface EligibilityResult {
  policyVersion: string;
  decision: OfferDecision;
  reasonCodes: PolicyReasonCode[];
  evidenceMode: EvidenceMode;
  metrics: EligibilityMetrics;
  /** Evidence references: ids of every snapshot in the evaluated series. */
  snapshotIds: string[];
}

const ZERO_METRICS: EligibilityMetrics = {
  completeWindows: 0,
  activePeriods: 0,
  incompleteWindows: 0,
  totalEligibleBaseUnits: "0",
  topPayerAddress: null,
  topPayerShareBps: 0,
  volatilityBps: 0,
  baselineBaseUnits: "0",
  baselineObservations: 0,
};

function sortReasonCodes(codes: PolicyReasonCode[]): PolicyReasonCode[] {
  return [...new Set(codes)].sort((a, b) => {
    const indexA = POLICY_DECISION_REASON_ORDER.indexOf(
      a as (typeof POLICY_DECISION_REASON_ORDER)[number],
    );
    const indexB = POLICY_DECISION_REASON_ORDER.indexOf(
      b as (typeof POLICY_DECISION_REASON_ORDER)[number],
    );
    return (
      (indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA) -
      (indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB)
    );
  });
}

function decide(codes: PolicyReasonCode[]): OfferDecision {
  if (codes.some((code) => INSUFFICIENT_EVIDENCE_CODES.has(code))) {
    return "insufficient_evidence";
  }
  if (codes.some((code) => DECLINED_CODES.has(code))) {
    return "declined";
  }
  return "eligible";
}

/**
 * Evaluates eligibility for one merchant's snapshot series. Throws on
 * structural violations (mixed evidence modes, mixed merchants, inconsistent
 * window durations) — synthetic and observed data are never silently combined.
 */
export function evaluateEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const { snapshots, classified, tokenDecimals, evidenceMode } = input;

  if (snapshots.length === 0) {
    return {
      policyVersion: POLICY_VERSION,
      decision: "insufficient_evidence",
      reasonCodes: ["policy_no_snapshots"],
      evidenceMode,
      metrics: ZERO_METRICS,
      snapshotIds: [],
    };
  }

  // Structural validation: one merchant, one evidence mode, one period length.
  const merchantIds = new Set(snapshots.map((s) => s.merchantId));
  if (merchantIds.size !== 1) {
    throw new Error("evaluateEligibility: snapshots span multiple merchants");
  }
  const evidenceModes = new Set(snapshots.map((s) => s.evidenceMode));
  if (evidenceModes.size !== 1 || !evidenceModes.has(evidenceMode)) {
    throw new Error(
      "evaluateEligibility: policy_mixed_evidence_modes — synthetic and observed evidence must never be combined",
    );
  }
  const durations = new Set(
    snapshots.map((s) => s.window.endSec - s.window.startSec),
  );
  if (durations.size !== 1) {
    throw new Error(
      "evaluateEligibility: snapshots have inconsistent window durations",
    );
  }
  const ordered = [...snapshots].sort(
    (a, b) => a.window.startSec - b.window.startSec,
  );
  const periodSeconds = ordered[0]!.window.endSec - ordered[0]!.window.startSec;
  let contiguous = true;
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1]!;
    const current = ordered[i]!;
    if (current.window.startSec - previous.window.startSec !== periodSeconds) {
      contiguous = false;
      break;
    }
  }

  const complete = ordered.filter((s) => s.completeness === "complete");
  const incompleteCount = ordered.length - complete.length;

  // Per-window clamped nets (zero-sales days included, negatives clamp to 0).
  const clampedNets = complete.map((s) => {
    const net = parseMoneyAmount(s.netEligibleAmount);
    return net < 0n ? 0n : net;
  });
  const totalEligible = clampedNets.reduce((sum, value) => sum + value, 0n);
  const activePeriods = clampedNets.filter((net) => net > 0n).length;

  // Join classified events to complete windows for payer-level metrics.
  const classifiedByRef = new Map(
    classified.map((event) => [eventRefKey(event.ref), event]),
  );
  const includedInComplete = new Map<string, bigint>(); // payer -> volume
  const circularVolumeByRef = new Map<string, bigint>(); // ref key -> volume
  const completeRefKeys = new Set<string>();
  for (const snapshot of complete) {
    for (const ref of snapshot.includedEvents)
      completeRefKeys.add(eventRefKey(ref));
    for (const excluded of snapshot.excludedEvents) {
      if (excluded.reasonCode === "policy_excluded_suspected_circular") {
        completeRefKeys.add(eventRefKey(excluded.ref));
        circularVolumeByRef.set(eventRefKey(excluded.ref), 0n);
      }
    }
  }
  for (const key of completeRefKeys) {
    const event = classifiedByRef.get(key);
    if (!event) {
      throw new Error(
        `evaluateEligibility: classified event missing for snapshot ref ${key}`,
      );
    }
    if (event.reasonCode === "policy_included_eligible_sale") {
      const volume = parseMoneyAmount(event.amountBaseUnits);
      includedInComplete.set(
        event.from,
        (includedInComplete.get(event.from) ?? 0n) + volume,
      );
    }
    if (event.reasonCode === "policy_excluded_suspected_circular") {
      circularVolumeByRef.set(key, parseMoneyAmount(event.amountBaseUnits));
    }
  }

  let topPayerAddress: HexAddress | null = null;
  let topPayerVolume = 0n;
  let includedVolumeTotal = 0n;
  for (const [payer, volume] of includedInComplete) {
    includedVolumeTotal += volume;
    if (volume > topPayerVolume) {
      topPayerVolume = volume;
      topPayerAddress = payer as HexAddress;
    }
  }
  const topPayerShareBps =
    includedVolumeTotal > 0n
      ? Number((topPayerVolume * 10000n) / includedVolumeTotal)
      : 0;

  const maxActiveDay = clampedNets.reduce(
    (max, value) => (value > max ? value : max),
    0n,
  );
  const volatilityBps =
    activePeriods > 0
      ? Number(
          (maxActiveDay * 10000n) /
            // floor(total / active) with a floor of 1 to avoid division by zero
            (totalEligible / BigInt(activePeriods) < 1n
              ? 1n
              : totalEligible / BigInt(activePeriods)),
        )
      : 0;

  const circularVolumeTotal = [...circularVolumeByRef.values()].reduce(
    (sum, value) => sum + value,
    0n,
  );

  const baseline = computeConservativeBaseline(ordered);

  // ---- Frozen checks, in the frozen order (docs/policy-v1.md section 5) ----
  const codes: PolicyReasonCode[] = [];
  if (incompleteCount > 0 || !contiguous)
    codes.push("policy_history_incomplete");
  if (complete.length < MIN_COMPLETE_WINDOWS)
    codes.push("policy_insufficient_history_windows");
  if (activePeriods < MIN_ACTIVE_PERIODS) {
    codes.push("policy_insufficient_history_active_periods");
  }
  if (totalEligible === 0n) {
    codes.push("policy_no_eligible_receipts");
  } else {
    const minimumVolume = wholeUnitsToBaseUnits(
      MIN_ELIGIBLE_VOLUME_WHOLE_UNITS,
      tokenDecimals,
    );
    if (totalEligible < minimumVolume)
      codes.push("policy_eligible_volume_below_minimum");
    if (
      includedVolumeTotal > 0n &&
      topPayerShareBps > MAX_TOP_PAYER_SHARE_BPS
    ) {
      codes.push("policy_payer_concentration_above_cap");
    }
    if (activePeriods > 0 && volatilityBps > MAX_ACTIVE_DAY_VOLATILITY_BPS) {
      codes.push("policy_volatility_above_cap");
    }
  }
  if (circularVolumeTotal > 0n) codes.push("policy_suspicious_flow_detected");

  const reasonCodes: PolicyReasonCode[] =
    codes.length > 0 ? sortReasonCodes(codes) : ["policy_meets_all_thresholds"];

  return {
    policyVersion: POLICY_VERSION,
    decision: decide(reasonCodes),
    reasonCodes,
    evidenceMode,
    metrics: {
      completeWindows: complete.length,
      activePeriods,
      incompleteWindows: incompleteCount,
      totalEligibleBaseUnits: formatMoneyAmount(totalEligible),
      topPayerAddress,
      topPayerShareBps,
      volatilityBps,
      baselineBaseUnits: formatMoneyAmount(baseline.valueBaseUnits),
      baselineObservations: baseline.observationCount,
    },
    snapshotIds: ordered.map((s) => s.id),
  };
}
