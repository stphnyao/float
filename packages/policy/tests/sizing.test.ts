import { describe, expect, it } from "vitest";
import { applyBasisPoints, type RevenueSnapshot } from "@float/contracts";
import {
  deterministicUuid,
  policyDefaultSizingInputs,
  sizeOffer,
  sizeOfferForDecision,
  wholeUnitsToBaseUnits,
  type EligibilityResult,
  type SizingInputs,
} from "../src/index.js";
import { DEMO_MERCHANT_ID, runFixturePipeline } from "./testhelpers.js";
import {
  buildDemoEligibleFixture,
  buildEdgeInactivityFixture,
} from "../../../fixtures/index.js";

const DECIMALS = 6;
const P = 86400;
const ANCHOR = 1758854400;

function units(whole: number): string {
  return `${whole}${"0".repeat(DECIMALS)}`;
}

function snapshotWithNet(whole: number, index: number): RevenueSnapshot {
  const window = {
    startSec: ANCHOR + index * P,
    endSec: ANCHOR + (index + 1) * P,
  };
  return {
    id: deterministicUuid("sizing-test", `${index}:${whole}`),
    merchantId: DEMO_MERCHANT_ID,
    window,
    includedEvents: [],
    excludedEvents: [],
    netEligibleAmount: units(whole),
    completeness: "complete",
    completenessNotes: "",
    evidenceMode: "synthetic_fixture",
    classificationVersion: "policy-v1",
    createdAtSec: ANCHOR + 30 * P,
  };
}

function defaults(overrides: Partial<SizingInputs> = {}): SizingInputs {
  return { ...policyDefaultSizingInputs(DECIMALS), ...overrides };
}

describe("sizeOffer (PLAN section 4 formulas, docs/policy-v1.md section 7)", () => {
  it("applies basis points with BigInt truncation, never floats", () => {
    expect(applyBasisPoints(999n, 5000)).toBe(499n);
    expect(applyBasisPoints(10_000_001n, 3333)).toBe(3_333_000n); // truncates toward zero
    expect(applyBasisPoints(0n, 10000)).toBe(0n);
    expect(applyBasisPoints(123n, 0)).toBe(0n);
    expect(() => applyBasisPoints(100n, 1.5)).toThrow();
  });

  it("scales whole units to base units with integer exponentiation", () => {
    expect(wholeUnitsToBaseUnits(500, 6)).toBe(500_000_000n);
    expect(wholeUnitsToBaseUnits(1, 0)).toBe(1n);
    expect(() => wholeUnitsToBaseUnits(5, -1)).toThrow();
    expect(() => wholeUnitsToBaseUnits(5, 2.5)).toThrow();
  });

  it("computes capacity, haircut, and cap for the demo_eligible baseline", () => {
    const snapshots = Array.from({ length: 21 }, (_, i) =>
      snapshotWithNet(610, i),
    );
    const result = sizeOffer(snapshots, defaults());
    // budget = floor(1000 * 610e6 / 10000) = 61e6, ceiling 100e6 does not bind
    expect(
      result.perPeriod.every((p) => p.collectionBudgetBaseUnits === "61000000"),
    ).toBe(true);
    expect(result.capacityBaseUnits).toBe(854_000_000n); // 14 x 61e6
    expect(result.principalBaseUnits).toBe(427_000_000n); // floor(854e6 * 0.5)
  });

  it("caps principal by the absolute demo maximum", () => {
    const snapshots = Array.from({ length: 21 }, (_, i) =>
      snapshotWithNet(5000, i),
    );
    // budget = 500e6 -> ceiling 100e6 binds per period; capacity = 1.4e9;
    // haircut -> 700e6 > max 500e6 -> principal 500e6.
    const result = sizeOffer(snapshots, defaults());
    expect(result.capacityBaseUnits).toBe(1_400_000_000n);
    expect(result.principalBaseUnits).toBe(
      wholeUnitsToBaseUnits(500, DECIMALS),
    );
  });

  it("caps each period by the period ceiling", () => {
    const snapshots = Array.from({ length: 21 }, (_, i) =>
      snapshotWithNet(9000, i),
    );
    const result = sizeOffer(snapshots, defaults({ collectionRateBps: 10000 }));
    expect(
      result.perPeriod.every((p) => p.collectionBudgetBaseUnits === units(100)),
    ).toBe(true);
    expect(result.capacityBaseUnits).toBe(1_400_000_000n);
  });

  it("yields zero principal for a zero baseline (inactivity)", () => {
    const fixture = buildEdgeInactivityFixture();
    const { build, eligibility } = runFixturePipeline(fixture);
    expect(eligibility.metrics.baselineBaseUnits).toBe("0");
    const result = sizeOffer(build.snapshots, defaults());
    expect(result.capacityBaseUnits).toBe(0n);
    expect(result.principalBaseUnits).toBe(0n);
  });

  it("respects a custom horizon of one period", () => {
    const snapshots = Array.from({ length: 21 }, (_, i) =>
      snapshotWithNet(610, i),
    );
    const result = sizeOffer(snapshots, defaults({ horizonPeriods: 1 }));
    expect(result.capacityBaseUnits).toBe(61_000_000n);
    expect(result.principalBaseUnits).toBe(30_500_000n);
    expect(result.perPeriod).toHaveLength(1);
  });

  it("records every input so an offer can show its work", () => {
    const snapshots = Array.from({ length: 21 }, (_, i) =>
      snapshotWithNet(610, i),
    );
    const result = sizeOffer(snapshots, defaults());
    expect(result.recordedInputs).toMatchObject({
      policyVersion: "policy-v1",
      tokenDecimals: DECIMALS,
      collectionRateBps: 1000,
      periodCeilingBaseUnits: units(100),
      sizingHaircutBps: 5000,
      maxPrincipalBaseUnits: units(500),
      horizonPeriods: 14,
      periodSeconds: 86400,
      baselinePercentileBps: 2500,
      baselineMethod: "p25_of_complete_windows_incl_zero_days",
      baselineValueBaseUnits: units(610),
      baselineObservations: 21,
      capacityBaseUnits: "854000000",
      principalBaseUnits: "427000000",
    });
    expect(result.recordedInputs.snapshotIds).toHaveLength(21);
  });

  it("rejects non-integer or out-of-range basis-point rates", () => {
    const snapshots = [snapshotWithNet(610, 0)];
    expect(() =>
      sizeOffer(snapshots, defaults({ collectionRateBps: 10000.5 })),
    ).toThrow();
    expect(() =>
      sizeOffer(snapshots, defaults({ sizingHaircutBps: -1 })),
    ).toThrow();
    expect(() =>
      sizeOffer(snapshots, defaults({ horizonPeriods: 0 })),
    ).toThrow();
  });

  it("refuses to size a non-eligible decision", () => {
    const eligibility: EligibilityResult = {
      policyVersion: "policy-v1",
      decision: "declined",
      reasonCodes: ["policy_volatility_above_cap"],
      evidenceMode: "synthetic_fixture",
      metrics: {
        completeWindows: 21,
        activePeriods: 21,
        incompleteWindows: 0,
        totalEligibleBaseUnits: units(8400),
        topPayerAddress: null,
        topPayerShareBps: 0,
        volatilityBps: 99999,
        baselineBaseUnits: units(400),
        baselineObservations: 21,
      },
      snapshotIds: [],
    };
    const gated = sizeOfferForDecision(
      eligibility,
      [snapshotWithNet(400, 0)],
      defaults(),
    );
    expect(gated.sized).toBe(false);
    if (!gated.sized) {
      expect(gated.reasonCode).toBe("policy_not_sized_non_eligible_decision");
    }
  });

  it("sizes an eligible decision end-to-end from the demo fixture", () => {
    const fixture = buildDemoEligibleFixture();
    const { eligibility, build } = runFixturePipeline(fixture);
    const gated = sizeOfferForDecision(
      eligibility,
      build.snapshots,
      policyDefaultSizingInputs(DECIMALS),
    );
    expect(gated.sized).toBe(true);
    if (gated.sized) {
      expect(gated.sizing.principalBaseUnits).toBe(427_000_000n);
      expect(gated.sizing.baseline.valueBaseUnits).toBe(610_000_000n);
    }
  });
});
