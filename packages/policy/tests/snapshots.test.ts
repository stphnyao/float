import { describe, expect, it } from "vitest";
import { parseMoneyAmount, type RevenueSnapshot } from "@float/contracts";
import {
  buildRevenueSnapshots,
  classifyEvents,
  DEFAULT_PERIOD_SECONDS,
  type ClassifiedEvent,
  type ClassificationContext,
} from "../src/index.js";
import {
  DEMO_MERCHANT_ID,
  fixtureClassificationContext,
} from "./testhelpers.js";
import { buildDemoEligibleFixture } from "../../../fixtures/index.js";

const ANCHOR = 1758854400;

function makeContext(
  overrides: Partial<ClassificationContext> = {},
): ClassificationContext {
  return {
    chainId: 42429,
    merchantAddress: "0x00000000000000000000000000000000000000a1",
    tokenAddress: "0x000000000000000000000000000000000000007e",
    treasuryAddress: "0x00000000000000000000000000000000000000a2",
    faucetSenders: [],
    knownSelfFundingSources: [],
    knownNonSaleSenders: [],
    priorIncludedPayers: [],
    seenEventRefs: [],
    ...overrides,
  };
}

function sale(
  dayIndex: number,
  txSeed: number,
  wholeUnits: number,
  merchant: string,
): Parameters<typeof classifyEvents>[0][number] {
  return {
    chainId: 42429,
    txHash: `0x${txSeed.toString(16).padStart(64, "0")}`,
    logIndex: 0,
    blockNumber: txSeed,
    blockHash: `0x${(txSeed + 500).toString(16).padStart(64, "0")}`,
    timestampSec: ANCHOR + dayIndex * DEFAULT_PERIOD_SECONDS + 3600,
    from: "0x00000000000000000000000000000000000000b1",
    to: merchant,
    tokenAddress: "0x000000000000000000000000000000000000007e",
    amountBaseUnits: `${wholeUnits}000000`,
  };
}

function build(
  events: Parameters<typeof classifyEvents>[0],
  context: ClassificationContext,
  nowSec: number,
  coverage: { startSec: number; endSec: number }[],
  settled: number[] = [],
) {
  const classified = classifyEvents(events, context);
  return buildRevenueSnapshots(classified, {
    merchantId: DEMO_MERCHANT_ID,
    chainId: context.chainId,
    evidenceMode: "synthetic_fixture",
    anchorSec: ANCHOR,
    nowSec,
    scanCoverage: coverage,
    settledWindowStartsSec: settled,
  });
}

describe("buildRevenueSnapshots", () => {
  const merchant = "0x00000000000000000000000000000000000000a1";
  const fullCoverage = [
    { startSec: ANCHOR, endSec: ANCHOR + 10 * DEFAULT_PERIOD_SECONDS },
  ];

  it("groups events into anchored windows with integer net amounts", () => {
    const events = [
      sale(0, 1, 100, merchant),
      sale(0, 2, 250, merchant),
      sale(1, 3, 400, merchant),
      sale(3, 4, 50, merchant),
    ];
    const result = build(
      events,
      makeContext(),
      ANCHOR + 10 * DEFAULT_PERIOD_SECONDS,
      fullCoverage,
    );
    expect(result.snapshots).toHaveLength(10); // all windows in the scanned span
    const window0 = result.snapshots[0]!;
    expect(window0.window).toEqual({
      startSec: ANCHOR,
      endSec: ANCHOR + DEFAULT_PERIOD_SECONDS,
    });
    expect(parseMoneyAmount(window0.netEligibleAmount)).toBe(350000000n);
    expect(parseMoneyAmount(result.snapshots[1]!.netEligibleAmount)).toBe(
      400000000n,
    );
    expect(parseMoneyAmount(result.snapshots[2]!.netEligibleAmount)).toBe(0n); // zero-sales day
    expect(
      result.snapshots.every((s) => s.evidenceMode === "synthetic_fixture"),
    ).toBe(true);
    expect(
      result.snapshots.every((s) => s.classificationVersion === "policy-v1"),
    ).toBe(true);
  });

  it("marks windows uncovered by scan coverage as incomplete", () => {
    const events = [sale(0, 1, 100, merchant), sale(5, 2, 100, merchant)];
    const gappedCoverage = [
      { startSec: ANCHOR, endSec: ANCHOR + 3 * DEFAULT_PERIOD_SECONDS },
      {
        startSec: ANCHOR + 5 * DEFAULT_PERIOD_SECONDS,
        endSec: ANCHOR + 10 * DEFAULT_PERIOD_SECONDS,
      },
    ];
    const result = build(
      events,
      makeContext(),
      ANCHOR + 10 * DEFAULT_PERIOD_SECONDS,
      gappedCoverage,
    );
    const completeness = result.snapshots.map((s) => s.completeness);
    expect(completeness).toHaveLength(10);
    expect(completeness[0]).toBe("complete");
    expect(completeness[2]).toBe("complete");
    expect(completeness[3]).toBe("incomplete");
    expect(completeness[4]).toBe("incomplete");
    expect(completeness[5]).toBe("complete");
    expect(completeness.filter((c) => c === "incomplete")).toHaveLength(2);
    expect(result.snapshots[3]!.completenessNotes).toContain("coverage gap");
  });

  it("does not build windows that end after nowSec", () => {
    const events = [sale(0, 1, 100, merchant), sale(9, 2, 100, merchant)];
    const result = build(
      events,
      makeContext(),
      ANCHOR + 9 * DEFAULT_PERIOD_SECONDS + 100,
      fullCoverage,
    );
    // window 8 is the last finished window (ends at anchor + 9P > nowSec? ends exactly at anchor+9P+0... window 8 ends at anchor+9P which is > now (now = anchor+9P+100? no: anchor+9P+100 > anchor+9P → window 8 IS finished)
    const lastIndex = result.snapshots.length - 1;
    expect(result.snapshots[lastIndex]!.window.endSec).toBeLessThanOrEqual(
      ANCHOR + 9 * DEFAULT_PERIOD_SECONDS + 100,
    );
  });

  it("produces deterministic snapshot ids for identical inputs and distinct ids for different content", () => {
    const events = [sale(0, 1, 100, merchant), sale(1, 2, 200, merchant)];
    const a = build(
      events,
      makeContext(),
      ANCHOR + 5 * DEFAULT_PERIOD_SECONDS,
      fullCoverage,
    );
    const b = build(
      events,
      makeContext(),
      ANCHOR + 5 * DEFAULT_PERIOD_SECONDS,
      fullCoverage,
    );
    expect(a.snapshots.map((s) => s.id)).toEqual(b.snapshots.map((s) => s.id));
    // Window 1 has a sale in `a` but is empty in `c`, so its snapshot id differs.
    const c = build(
      [events[0]!],
      makeContext(),
      ANCHOR + 5 * DEFAULT_PERIOD_SECONDS,
      fullCoverage,
    );
    expect(c.snapshots[1]!.id).not.toBe(a.snapshots[1]!.id);
    // Identical windows still hash identically.
    expect(c.snapshots[0]!.id).toBe(a.snapshots[0]!.id);
  });

  it("applies refunds append-only to a later unprocessed window, never the origin window", () => {
    const payer = "0x00000000000000000000000000000000000000b1";
    const events = [
      sale(2, 1, 500, merchant),
      {
        ...sale(4, 2, 0, merchant),
        amountBaseUnits: "-120000000", // refund in window 4
        from: payer,
      },
      sale(6, 3, 300, merchant),
    ];
    // No settled windows: refund lands in the first LATER window (5).
    const result = build(
      events,
      makeContext(),
      ANCHOR + 10 * DEFAULT_PERIOD_SECONDS,
      fullCoverage,
    );
    expect(parseMoneyAmount(result.snapshots[2]!.netEligibleAmount)).toBe(
      500000000n,
    );
    expect(parseMoneyAmount(result.snapshots[4]!.netEligibleAmount)).toBe(0n);
    expect(parseMoneyAmount(result.snapshots[5]!.netEligibleAmount)).toBe(
      -120000000n,
    );
    expect(parseMoneyAmount(result.snapshots[6]!.netEligibleAmount)).toBe(
      300000000n,
    );
    expect(result.snapshots[5]!.completenessNotes).toContain(
      "refund adjustment",
    );
    // The origin window records the refund as an excluded adjustment event.
    expect(
      result.snapshots[4]!.excludedEvents.map((e) => e.reasonCode),
    ).toEqual(["policy_adjustment_refund"]);
  });

  it("never rewrites settled windows: refunds skip them and defer instead", () => {
    const payer = "0x00000000000000000000000000000000000000b1";
    const events = [
      sale(2, 1, 500, merchant),
      {
        ...sale(4, 2, 0, merchant),
        amountBaseUnits: "-120000000",
        from: payer,
      },
    ];
    const settled = [3, 4, 5, 6, 7, 8, 9].map(
      (k) => ANCHOR + k * DEFAULT_PERIOD_SECONDS,
    );
    const result = build(
      events,
      makeContext(),
      ANCHOR + 10 * DEFAULT_PERIOD_SECONDS,
      fullCoverage,
      settled,
    );
    // Window 2 (unsettled) keeps its sale; window 4 (settled) keeps its
    // original net — the refund is NOT applied there.
    expect(parseMoneyAmount(result.snapshots[2]!.netEligibleAmount)).toBe(
      500000000n,
    );
    expect(parseMoneyAmount(result.snapshots[4]!.netEligibleAmount)).toBe(0n);
    // No later unprocessed window exists -> carried forward.
    expect(result.deferredAdjustments).toHaveLength(1);
    expect(
      parseMoneyAmount(result.deferredAdjustments[0]!.amountBaseUnits),
    ).toBe(-120000000n);
  });

  it("carries the evidence mode through and never mixes modes", () => {
    const fixture = buildDemoEligibleFixture();
    const classified = classifyEvents(
      fixture.events,
      fixtureClassificationContext(fixture),
    );
    const result = buildRevenueSnapshots(classified, {
      merchantId: DEMO_MERCHANT_ID,
      chainId: fixture.chainId,
      evidenceMode: "observed_testnet",
      anchorSec: fixture.anchorSec,
      nowSec: fixture.nowSec,
      scanCoverage: fixture.scanCoverage,
    });
    expect(result.evidenceMode).toBe("observed_testnet");
    expect(
      result.snapshots.every((s) => s.evidenceMode === "observed_testnet"),
    ).toBe(true);
  });

  it("keeps snapshot windows contiguous across the whole scanned span", () => {
    const fixture = buildDemoEligibleFixture();
    const classification = classifyEvents(
      fixture.events,
      fixtureClassificationContext(fixture),
    );
    const result = buildRevenueSnapshots(classification, {
      merchantId: DEMO_MERCHANT_ID,
      chainId: fixture.chainId,
      evidenceMode: "synthetic_fixture",
      anchorSec: fixture.anchorSec,
      nowSec: fixture.nowSec,
      scanCoverage: fixture.scanCoverage,
    });
    expect(result.snapshots).toHaveLength(30);
    for (let i = 1; i < result.snapshots.length; i += 1) {
      const previous = result.snapshots[i - 1]!;
      const current = result.snapshots[i]!;
      expect(current.window.startSec - previous.window.startSec).toBe(
        DEFAULT_PERIOD_SECONDS,
      );
    }
  });

  it("validates produced snapshots against the frozen RevenueSnapshot contract", () => {
    const fixture = buildDemoEligibleFixture();
    const classified = classifyEvents(
      fixture.events,
      fixtureClassificationContext(fixture),
    );
    const result = buildRevenueSnapshots(classified, {
      merchantId: DEMO_MERCHANT_ID,
      chainId: fixture.chainId,
      evidenceMode: fixture.evidenceMode,
      anchorSec: fixture.anchorSec,
      nowSec: fixture.nowSec,
      scanCoverage: fixture.scanCoverage,
    });
    for (const snapshot of result.snapshots as RevenueSnapshot[]) {
      expect(snapshot.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(snapshot.netEligibleAmount).toMatch(/^-?\d+$/);
    }
  });
});
