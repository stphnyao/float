import { describe, expect, it } from "vitest";
import type { EventReference, RevenueSnapshot } from "@float/contracts";
import {
  deterministicUuid,
  evaluateEligibility,
  type ClassifiedEvent,
  type EligibilityInput,
} from "../src/index.js";

const DECIMALS = 6;
const P = 86400;
const ANCHOR = 1758854400;
const MERCHANT_ID = "0b8f9a10-0000-4000-8000-0000000000c1";
const MERCHANT = "0x00000000000000000000000000000000000000a1";
const PAYER_A = "0x00000000000000000000000000000000000000b1";
const PAYER_B = "0x00000000000000000000000000000000000000b2";

function units(whole: number): string {
  return `${whole}${"0".repeat(DECIMALS)}`;
}

/** Builds a complete-window snapshot series with per-window net amounts (whole units). */
function makeSnapshots(
  netsWholeUnits: number[],
  opts: { incompleteAt?: number[]; start?: number } = {},
): RevenueSnapshot[] {
  const start = opts.start ?? ANCHOR;
  const incomplete = new Set(opts.incompleteAt ?? []);
  return netsWholeUnits.map((net, k) => {
    const window = { startSec: start + k * P, endSec: start + (k + 1) * P };
    return {
      id: deterministicUuid("test", `${window.startSec}:${net}`),
      merchantId: MERCHANT_ID,
      window,
      includedEvents: [] as EventReference[],
      excludedEvents: [],
      netEligibleAmount: units(net),
      completeness: incomplete.has(k)
        ? ("incomplete" as const)
        : ("complete" as const),
      completenessNotes: incomplete.has(k) ? "coverage gap (test)" : "",
      evidenceMode: "synthetic_fixture" as const,
      classificationVersion: "policy-v1",
      createdAtSec: start + netsWholeUnits.length * P,
    };
  });
}

function evaluate(
  snapshots: RevenueSnapshot[],
  classified: ClassifiedEvent[] = [],
): ReturnType<typeof evaluateEligibility> {
  const input: EligibilityInput = {
    snapshots,
    classified,
    tokenDecimals: DECIMALS,
    evidenceMode: "synthetic_fixture",
  };
  return evaluateEligibility(input);
}

describe("evaluateEligibility thresholds (docs/policy-v1.md section 5)", () => {
  it("an empty series is insufficient evidence, never a guess", () => {
    const result = evaluate([]);
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.reasonCodes).toEqual(["policy_no_snapshots"]);
    expect(result.evidenceMode).toBe("synthetic_fixture");
  });

  it("exactly 21 complete active windows with enough volume is eligible", () => {
    const result = evaluate(makeSnapshots(Array(21).fill(400)));
    expect(result.metrics.completeWindows).toBe(21);
    expect(result.metrics.activePeriods).toBe(21);
    expect(result.decision).toBe("eligible");
    expect(result.reasonCodes).toEqual(["policy_meets_all_thresholds"]);
  });

  it("20 complete windows fails the complete-window minimum", () => {
    const result = evaluate(makeSnapshots(Array(20).fill(400)));
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.reasonCodes).toContain("policy_insufficient_history_windows");
  });

  it("14 active periods of 21 complete windows fails the active-period minimum", () => {
    const nets = Array(21).fill(400) as number[];
    nets[0] = 0;
    nets[1] = 0;
    nets[2] = 0;
    nets[3] = 0;
    nets[4] = 0;
    nets[5] = 0;
    nets[6] = 0; // 7 zero days -> 14 active
    const result = evaluate(makeSnapshots(nets));
    expect(result.metrics.activePeriods).toBe(14);
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.reasonCodes).toContain(
      "policy_insufficient_history_active_periods",
    );
  });

  it("15 active periods of 21 complete windows passes the active-period minimum", () => {
    const nets = Array(21).fill(400) as number[];
    for (let i = 0; i < 6; i += 1) nets[i] = 0;
    const result = evaluate(makeSnapshots(nets));
    expect(result.metrics.activePeriods).toBe(15);
    expect(result.decision).toBe("eligible");
  });

  it("total eligible volume below 300 whole units is declined", () => {
    const result = evaluate(makeSnapshots(Array(21).fill(14))); // 294 total
    expect(result.decision).toBe("declined");
    expect(result.reasonCodes).toEqual([
      "policy_eligible_volume_below_minimum",
    ]);
  });

  it("exactly 300 whole units is not below the minimum", () => {
    const nets = Array(21).fill(0) as number[];
    for (let i = 6; i < 21; i += 1) nets[i] = 20; // 15 x 20 = 300
    const result = evaluate(makeSnapshots(nets));
    expect(result.metrics.totalEligibleBaseUnits).toBe(units(300));
    expect(result.decision).toBe("eligible");
  });

  it("zero eligible receipts is insufficient evidence (never a guess)", () => {
    const result = evaluate(makeSnapshots(Array(21).fill(0)));
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.reasonCodes).toEqual([
      "policy_insufficient_history_active_periods",
      "policy_no_eligible_receipts",
    ]);
  });

  it("any incomplete window in the series forces insufficient evidence", () => {
    const result = evaluate(
      makeSnapshots(Array(21).fill(400), { incompleteAt: [20] }),
    );
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.reasonCodes).toContain("policy_history_incomplete");
  });

  it("a non-contiguous series is treated as incomplete history", () => {
    const snapshots = [
      ...makeSnapshots(Array(15).fill(400)),
      ...makeSnapshots(Array(6).fill(400), { start: ANCHOR + 20 * P }), // gap at windows 15..19
    ];
    const result = evaluate(snapshots);
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.reasonCodes).toContain("policy_history_incomplete");
  });

  it("top-payer share above 6000 bps is declined; exactly 6000 bps passes", () => {
    const buildSeries = (shareA: number) => {
      const snapshots: RevenueSnapshot[] = [];
      const classified: ClassifiedEvent[] = [];
      let txIndex = 0;
      for (let k = 0; k < 21; k += 1) {
        const window = {
          startSec: ANCHOR + k * P,
          endSec: ANCHOR + (k + 1) * P,
        };
        const amountA = units(shareA);
        const amountB = units(100 - shareA);
        const refs: EventReference[] = [];
        for (const [payer, amount] of [
          [PAYER_A, amountA],
          [PAYER_B, amountB],
        ] as const) {
          const ref: EventReference = {
            chainId: 42429,
            txHash: `0x${(txIndex + 1).toString(16).padStart(64, "0")}`,
            logIndex: 0,
          };
          txIndex += 1;
          refs.push(ref);
          classified.push({
            ref,
            outcome: "included",
            reasonCode: "policy_included_eligible_sale",
            provenance: "test",
            from: payer,
            to: MERCHANT,
            timestampSec: window.startSec + 3600,
            amountBaseUnits: amount,
            classificationVersion: "policy-v1",
          });
        }
        snapshots.push({
          id: deterministicUuid("test", window.startSec.toString(10)),
          merchantId: MERCHANT_ID,
          window,
          includedEvents: refs,
          excludedEvents: [],
          netEligibleAmount: units(100),
          completeness: "complete",
          completenessNotes: "",
          evidenceMode: "synthetic_fixture",
          classificationVersion: "policy-v1",
          createdAtSec: ANCHOR + 21 * P,
        });
      }
      return { snapshots, classified };
    };

    const failing = evaluate(
      buildSeries(61).snapshots,
      buildSeries(61).classified,
    );
    expect(failing.decision).toBe("declined");
    expect(failing.reasonCodes).toEqual([
      "policy_payer_concentration_above_cap",
    ]);

    const passing = evaluate(
      buildSeries(60).snapshots,
      buildSeries(60).classified,
    );
    expect(passing.metrics.topPayerShareBps).toBe(6000);
    expect(passing.decision).toBe("eligible");
  });

  it("volatility above 25000 bps (max active day vs mean active day) is declined", () => {
    const nets = Array(21).fill(100) as number[];
    nets[0] = 12000;
    const result = evaluate(makeSnapshots(nets));
    expect(result.metrics.volatilityBps).toBeGreaterThan(25000);
    expect(result.decision).toBe("declined");
    expect(result.reasonCodes).toEqual(["policy_volatility_above_cap"]);
  });

  it("suspicious (suspected circular) volume in complete windows forces a decline", () => {
    const snapshots = makeSnapshots(Array(21).fill(400));
    const classified: ClassifiedEvent[] = [
      {
        ref: { chainId: 42429, txHash: `0x${"cc".repeat(32)}`, logIndex: 0 },
        outcome: "excluded",
        reasonCode: "policy_excluded_suspected_circular",
        provenance: "test",
        from: PAYER_A,
        to: MERCHANT,
        timestampSec: ANCHOR + 3600,
        amountBaseUnits: units(50),
        classificationVersion: "policy-v1",
      },
    ];
    // The circular event must belong to a complete window's excluded list.
    snapshots[0]!.excludedEvents.push({
      ref: classified[0]!.ref,
      reasonCode: "policy_excluded_suspected_circular",
    });
    const result = evaluate(snapshots, classified);
    expect(result.decision).toBe("declined");
    expect(result.reasonCodes).toEqual(["policy_suspicious_flow_detected"]);
  });

  it("insufficient evidence takes precedence over declined reasons and returns all codes", () => {
    // 22 complete windows (passes window count), 5 active (fails), small volume would also fail
    // but total is 0 -> no_eligible_receipts; expect both codes with insufficient decision.
    const result = evaluate(makeSnapshots(Array(22).fill(0)));
    expect(result.decision).toBe("insufficient_evidence");
    expect(result.reasonCodes).toEqual([
      "policy_insufficient_history_active_periods",
      "policy_no_eligible_receipts",
    ]);
  });

  it("returns metrics and snapshot evidence references", () => {
    const result = evaluate(makeSnapshots(Array(21).fill(400)));
    expect(result.policyVersion).toBe("policy-v1");
    expect(result.metrics.totalEligibleBaseUnits).toBe(units(8400));
    expect(result.metrics.baselineObservations).toBe(21);
    expect(result.snapshotIds).toHaveLength(21);
  });

  it("throws on mixed evidence modes instead of silently combining", () => {
    const snapshots = [
      ...makeSnapshots(Array(15).fill(400)),
      ...makeSnapshots(Array(6).fill(400), { start: ANCHOR + 15 * P }),
    ];
    snapshots[20]!.evidenceMode = "observed_testnet";
    expect(() => evaluate(snapshots)).toThrow(/policy_mixed_evidence_modes/);
  });

  it("throws on snapshots of different merchants", () => {
    const snapshots = makeSnapshots(Array(21).fill(400));
    snapshots[5]!.merchantId = "11111111-2222-4333-8444-555555555555";
    expect(() => evaluate(snapshots)).toThrow(/multiple merchants/);
  });
});
