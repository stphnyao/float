import { describe, expect, it } from "vitest";
import { canonicalJson } from "@float/contracts";
import {
  ALL_FIXTURE_BUILDERS,
  buildEdgeRefundsFixture,
} from "../../../fixtures/index.js";
import { classifyEvents, eventRefKey } from "../src/index.js";
import { runFixturePipeline } from "./testhelpers.js";

/** Deterministic LCG shuffle so the shuffle itself is reproducible. */
function shuffled<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    const a = copy[i]!;
    const b = copy[j]!;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

describe("determinism and money safety", () => {
  it("every fixture pipeline is byte-identical when run twice", () => {
    for (const builder of ALL_FIXTURE_BUILDERS) {
      const fixture = builder();
      const first = runFixturePipeline(fixture);
      const second = runFixturePipeline(fixture);
      expect(JSON.stringify(first), fixture.name).toBe(JSON.stringify(second));
    }
  });

  it("input batch order never changes classification, snapshots, or decisions", () => {
    for (const builder of ALL_FIXTURE_BUILDERS) {
      const fixture = builder();
      const forward = runFixturePipeline(fixture);
      const shuffledPipeline = runFixturePipeline({
        ...fixture,
        events: shuffled(fixture.events, 20260926),
      });
      expect(shuffledPipeline.classification, fixture.name).toEqual(
        forward.classification,
      );
      expect(shuffledPipeline.build.snapshots, fixture.name).toEqual(
        forward.build.snapshots,
      );
      expect(shuffledPipeline.eligibility.decision, fixture.name).toBe(
        forward.eligibility.decision,
      );
      expect(shuffledPipeline.eligibility.reasonCodes, fixture.name).toEqual(
        forward.eligibility.reasonCodes,
      );
      expect(shuffledPipeline.eligibility.metrics, fixture.name).toEqual(
        forward.eligibility.metrics,
      );
    }
  });

  it("no float ever enters an amount: all outputs are integer strings or BigInt", () => {
    for (const builder of ALL_FIXTURE_BUILDERS) {
      const fixture = builder();
      const { classification, build, eligibility } =
        runFixturePipeline(fixture);
      for (const event of classification.events) {
        expect(
          event.amountBaseUnits,
          `${fixture.name} ${eventRefKey(event.ref)}`,
        ).toMatch(/^-?\d+$/);
      }
      for (const snapshot of build.snapshots) {
        expect(snapshot.netEligibleAmount).toMatch(/^-?\d+$/);
      }
      expect(() =>
        BigInt(eligibility.metrics.totalEligibleBaseUnits),
      ).not.toThrow();
      expect(() => BigInt(eligibility.metrics.baselineBaseUnits)).not.toThrow();
    }
  });

  it("canonicalJson rejects floats (the money boundary holds)", () => {
    expect(() => canonicalJson({ amount: 0.5 })).toThrow(/float/);
    expect(canonicalJson({ amount: 5 })).toBe('{"amount":5}');
  });

  it("a float amount is rejected at the contract boundary", () => {
    const fixture = buildEdgeRefundsFixture();
    const poisoned = { ...fixture.events[0]!, amountBaseUnits: "1.5" };
    expect(() =>
      classifyEvents([poisoned], {
        chainId: fixture.chainId,
        merchantAddress: fixture.addresses.merchant,
        tokenAddress: fixture.addresses.token,
        treasuryAddress: fixture.addresses.treasury,
        faucetSenders: [fixture.addresses.faucet],
        knownSelfFundingSources: [],
        knownNonSaleSenders: [],
        priorIncludedPayers: [],
        seenEventRefs: [],
      }),
    ).toThrow();
  });
});
