import { describe, expect, it } from "vitest";
import { parseMoneyAmount } from "@float/contracts";
import {
  ALL_FIXTURE_BUILDERS,
  DEMO_FIXTURE_BUILDERS,
  EDGE_FIXTURE_BUILDERS,
} from "../../../fixtures/index.js";
import { policyDefaultSizingInputs, sizeOffer } from "../src/index.js";
import { runFixturePipeline } from "./testhelpers.js";

describe("labeled fixtures (expected classification + decision + sizing)", () => {
  it("exposes three demo fixtures and seven edge fixtures, all labeled synthetic", () => {
    expect(DEMO_FIXTURE_BUILDERS).toHaveLength(3);
    expect(EDGE_FIXTURE_BUILDERS).toHaveLength(7);
    for (const builder of ALL_FIXTURE_BUILDERS) {
      const fixture = builder();
      expect(fixture.evidenceMode).toBe("synthetic_fixture");
      expect(fixture.kind === "demo" || fixture.kind === "edge").toBe(true);
      expect(fixture.events.length).toBeGreaterThan(0);
      expect(fixture.expected.reasonCodes.length).toBeGreaterThan(0);
    }
  });

  for (const builder of ALL_FIXTURE_BUILDERS) {
    const fixture = builder();

    it(`${fixture.name}: classifies exactly as expected`, () => {
      const { classification } = runFixturePipeline(fixture);
      const included = classification.events.filter(
        (e) => e.outcome === "included",
      ).length;
      const adjustments = classification.events.filter(
        (e) => e.outcome === "adjustment",
      ).length;
      const excludedByReason: Record<string, number> = {};
      for (const event of classification.events) {
        if (event.outcome !== "excluded") continue;
        excludedByReason[event.reasonCode] =
          (excludedByReason[event.reasonCode] ?? 0) + 1;
      }
      expect(included).toBe(fixture.expected.classification.included);
      expect(adjustments).toBe(fixture.expected.classification.adjustments);
      expect(excludedByReason).toEqual(
        fixture.expected.classification.excluded,
      );
      expect(classification.classificationVersion).toBe("policy-v1");
    });

    it(`${fixture.name}: decides ${fixture.expected.decision} with frozen reasons and metrics`, () => {
      const { eligibility } = runFixturePipeline(fixture);
      expect(eligibility.decision).toBe(fixture.expected.decision);
      expect(eligibility.reasonCodes).toEqual(fixture.expected.reasonCodes);
      expect(eligibility.evidenceMode).toBe(fixture.evidenceMode);
      expect(eligibility.policyVersion).toBe("policy-v1");
      if (fixture.expected.metrics) {
        const expected = fixture.expected.metrics;
        const baseUnits = (whole: number) =>
          (BigInt(whole) * 10n ** BigInt(fixture.tokenDecimals)).toString();
        expect(eligibility.metrics.completeWindows).toBe(
          expected.completeWindows,
        );
        expect(eligibility.metrics.activePeriods).toBe(expected.activePeriods);
        expect(eligibility.metrics.incompleteWindows).toBe(
          expected.incompleteWindows ?? 0,
        );
        expect(eligibility.metrics.totalEligibleBaseUnits).toBe(
          baseUnits(expected.totalEligibleWholeUnits),
        );
        expect(eligibility.metrics.topPayerShareBps).toBe(
          expected.topPayerShareBps,
        );
        expect(eligibility.metrics.volatilityBps).toBe(expected.volatilityBps);
        if (expected.baselineWholeUnits !== undefined) {
          expect(eligibility.metrics.baselineBaseUnits).toBe(
            baseUnits(expected.baselineWholeUnits),
          );
        }
      }
    });

    it(`${fixture.name}: defers the expected number of refund adjustments`, () => {
      const { build } = runFixturePipeline(fixture);
      expect(build.deferredAdjustments).toHaveLength(
        fixture.expected.deferredAdjustments ?? 0,
      );
    });

    it(`${fixture.name}: produces the expected window nets`, () => {
      const { build } = runFixturePipeline(fixture);
      const netsByIndex = new Map(
        build.snapshots.map((s) => [
          Math.round(
            (s.window.startSec - fixture.anchorSec) / fixture.periodSeconds,
          ),
          parseMoneyAmount(s.netEligibleAmount),
        ]),
      );
      for (const [index, wholeUnits] of Object.entries(
        fixture.expected.windowNetsWholeUnits ?? {},
      )) {
        const net = netsByIndex.get(Number(index));
        expect(net, `window ${index}`).toBe(
          BigInt(wholeUnits) * 10n ** BigInt(fixture.tokenDecimals),
        );
      }
    });

    it(`${fixture.name}: sizes exactly as expected (or not at all)`, () => {
      const { eligibility, build } = runFixturePipeline(fixture);
      if (!fixture.expected.sizing) {
        expect(eligibility.decision).not.toBe("eligible");
        return;
      }
      expect(eligibility.decision).toBe("eligible");
      const expected = fixture.expected.sizing;
      const sizing = sizeOffer(
        build.snapshots,
        policyDefaultSizingInputs(fixture.tokenDecimals),
      );
      expect(sizing.perPeriod[0]!.collectionBudgetBaseUnits).toBe(
        expected.perPeriodBudgetBaseUnits,
      );
      expect(
        sizing.perPeriod.every(
          (p) =>
            p.collectionBudgetBaseUnits === expected.perPeriodBudgetBaseUnits,
        ),
      ).toBe(true);
      expect(sizing.capacityBaseUnits).toBe(BigInt(expected.capacityBaseUnits));
      expect(sizing.principalBaseUnits).toBe(
        BigInt(expected.principalBaseUnits),
      );
    });
  }
});
