import {
  applyBasisPoints,
  basisPointsSchema,
  formatMoneyAmount,
  type RevenueSnapshot,
} from "@float/contracts";
import {
  computeConservativeBaseline,
  type ConservativeBaseline,
} from "./baseline.js";
import {
  BASELINE_PERCENTILE_BPS,
  DEFAULT_COLLECTION_RATE_BPS,
  DEFAULT_PERIOD_CEILING_WHOLE_UNITS,
  DEFAULT_PERIOD_SECONDS,
  FORECAST_HORIZON_PERIODS,
  MAX_PRINCIPAL_WHOLE_UNITS,
  POLICY_VERSION,
  SIZING_HAIRCUT_BPS,
  wholeUnitsToBaseUnits,
} from "./version.js";
import type { EligibilityResult } from "./eligibility.js";

/**
 * Offer sizing (docs/policy-v1.md section 7), implementing PLAN.md section 4
 * exactly, with BigInt/integer math only:
 *
 *   capacity  = sum over horizon periods of
 *                 min( floor(rate_bps * conservative_receipts[p] / 10000),
 *                      period_ceiling_base_units )
 *   principal = min( floor(capacity * haircut_bps / 10000),
 *                    max_principal_base_units )
 *
 * In v1, conservative_receipts[p] is the frozen P25 baseline for every
 * horizon period (no seasonality model); the per-period table exists so a v2
 * can vary it. Every output records its inputs so each offer can show its work.
 */
export interface SizingInputs {
  /** Verified token decimals (adapter-verified, never assumed). */
  tokenDecimals: number;
  collectionRateBps: number;
  periodCeilingBaseUnits: bigint;
  sizingHaircutBps: number;
  maxPrincipalBaseUnits: bigint;
  horizonPeriods: number;
}

/** Frozen default sizing inputs, scaled to base units by verified decimals. */
export function policyDefaultSizingInputs(tokenDecimals: number): SizingInputs {
  return {
    tokenDecimals,
    collectionRateBps: DEFAULT_COLLECTION_RATE_BPS,
    periodCeilingBaseUnits: wholeUnitsToBaseUnits(
      DEFAULT_PERIOD_CEILING_WHOLE_UNITS,
      tokenDecimals,
    ),
    sizingHaircutBps: SIZING_HAIRCUT_BPS,
    maxPrincipalBaseUnits: wholeUnitsToBaseUnits(
      MAX_PRINCIPAL_WHOLE_UNITS,
      tokenDecimals,
    ),
    horizonPeriods: FORECAST_HORIZON_PERIODS,
  };
}

export interface SizingResult {
  policyVersion: string;
  principalBaseUnits: bigint;
  capacityBaseUnits: bigint;
  baseline: ConservativeBaseline;
  perPeriod: Array<{
    periodIndex: number;
    conservativeReceiptsBaseUnits: string;
    collectionBudgetBaseUnits: string;
  }>;
  recordedInputs: {
    policyVersion: string;
    tokenDecimals: number;
    collectionRateBps: number;
    periodCeilingBaseUnits: string;
    sizingHaircutBps: number;
    maxPrincipalBaseUnits: string;
    horizonPeriods: number;
    periodSeconds: number;
    baselinePercentileBps: number;
    baselineMethod: string;
    baselineValueBaseUnits: string;
    baselineObservations: number;
    snapshotIds: string[];
    capacityBaseUnits: string;
    principalBaseUnits: string;
  };
}

function assertBps(value: number, label: string): void {
  const parsed = basisPointsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${label} must be an integer basis-point rate in [0, 10000]`,
    );
  }
}

export function sizeOffer(
  snapshots: RevenueSnapshot[],
  inputs: SizingInputs,
): SizingResult {
  const { tokenDecimals } = inputs;
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0) {
    throw new Error(
      `token decimals must be a non-negative integer (got ${tokenDecimals})`,
    );
  }
  assertBps(inputs.collectionRateBps, "collectionRateBps");
  assertBps(inputs.sizingHaircutBps, "sizingHaircutBps");
  if (!Number.isInteger(inputs.horizonPeriods) || inputs.horizonPeriods <= 0) {
    throw new Error(
      `horizonPeriods must be a positive integer (got ${inputs.horizonPeriods})`,
    );
  }
  if (inputs.periodCeilingBaseUnits < 0n || inputs.maxPrincipalBaseUnits < 0n) {
    throw new Error("period ceiling and max principal must be non-negative");
  }

  const baseline = computeConservativeBaseline(snapshots);

  const perPeriod: SizingResult["perPeriod"] = [];
  let capacity = 0n;
  for (
    let periodIndex = 0;
    periodIndex < inputs.horizonPeriods;
    periodIndex += 1
  ) {
    const conservativeReceipts = baseline.valueBaseUnits; // frozen constant across the horizon in v1
    const collectionBudget = minBigint(
      applyBasisPoints(conservativeReceipts, inputs.collectionRateBps),
      inputs.periodCeilingBaseUnits,
    );
    capacity += collectionBudget;
    perPeriod.push({
      periodIndex,
      conservativeReceiptsBaseUnits: formatMoneyAmount(conservativeReceipts),
      collectionBudgetBaseUnits: formatMoneyAmount(collectionBudget),
    });
  }

  const haircutCapacity = applyBasisPoints(capacity, inputs.sizingHaircutBps);
  const principal = minBigint(haircutCapacity, inputs.maxPrincipalBaseUnits);

  return {
    policyVersion: POLICY_VERSION,
    principalBaseUnits: principal,
    capacityBaseUnits: capacity,
    baseline,
    perPeriod,
    recordedInputs: {
      policyVersion: POLICY_VERSION,
      tokenDecimals,
      collectionRateBps: inputs.collectionRateBps,
      periodCeilingBaseUnits: formatMoneyAmount(inputs.periodCeilingBaseUnits),
      sizingHaircutBps: inputs.sizingHaircutBps,
      maxPrincipalBaseUnits: formatMoneyAmount(inputs.maxPrincipalBaseUnits),
      horizonPeriods: inputs.horizonPeriods,
      periodSeconds: DEFAULT_PERIOD_SECONDS,
      baselinePercentileBps: BASELINE_PERCENTILE_BPS,
      baselineMethod: baseline.method,
      baselineValueBaseUnits: formatMoneyAmount(baseline.valueBaseUnits),
      baselineObservations: baseline.observationCount,
      snapshotIds: snapshots.map((s) => s.id),
      capacityBaseUnits: formatMoneyAmount(capacity),
      principalBaseUnits: formatMoneyAmount(principal),
    },
  };
}

export type OfferSizing =
  | { sized: true; policyVersion: string; sizing: SizingResult }
  | {
      sized: false;
      policyVersion: string;
      reasonCode: "policy_not_sized_non_eligible_decision";
    };

/**
 * Gates sizing on an eligible decision: any other decision yields no
 * principal (docs/policy-v1.md section 7).
 */
export function sizeOfferForDecision(
  eligibility: EligibilityResult,
  snapshots: RevenueSnapshot[],
  inputs: SizingInputs,
): OfferSizing {
  if (eligibility.decision !== "eligible") {
    return {
      sized: false,
      policyVersion: POLICY_VERSION,
      reasonCode: "policy_not_sized_non_eligible_decision",
    };
  }
  return {
    sized: true,
    policyVersion: POLICY_VERSION,
    sizing: sizeOffer(snapshots, inputs),
  };
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
