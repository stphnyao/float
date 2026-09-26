import {
  buildAddressBook,
  buildFixture,
  EventFactory,
  FIXTURE_ANCHOR_SEC,
  FIXTURE_PERIOD_SECONDS,
  splitDailyTotal,
} from "../helpers.js";
import type {
  FixtureCoverageRange,
  FixtureEvent,
  MerchantHistoryFixture,
} from "../types.js";

/**
 * Edge: incomplete history (scan gap). Sales are steady, but the scan coverage
 * has a 3-day gap (windows 10-12) inside the evaluated span. Expected:
 * insufficient_evidence on history completeness — incomplete data pauses,
 * never reuses stale totals. Evidence mode: synthetic_fixture.
 */
export function buildEdgeIncompleteHistoryFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xdd,
    treasurySeed: 0xde,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [0xfd, 0xfe],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const events: FixtureEvent[] = [];
  for (let day = 0; day < 30; day += 1) {
    if (day >= 10 && day <= 12) continue; // inside the scan gap: no ingested events
    const parts = splitDailyTotal(500, [6000, 4000]); // 300 / 200
    parts.forEach((wholeUnits, payerIndex) => {
      events.push(
        factory.payment(day, addresses.payers[payerIndex]!, wholeUnits),
      );
    });
  }

  const scanCoverage: FixtureCoverageRange[] = [
    {
      startSec: FIXTURE_ANCHOR_SEC,
      endSec: FIXTURE_ANCHOR_SEC + 10 * FIXTURE_PERIOD_SECONDS,
    },
    {
      startSec: FIXTURE_ANCHOR_SEC + 13 * FIXTURE_PERIOD_SECONDS,
      endSec: FIXTURE_ANCHOR_SEC + 30 * FIXTURE_PERIOD_SECONDS,
    },
  ];

  return buildFixture({
    name: "edge_incomplete_history",
    kind: "edge",
    description:
      "Steady sales with a 3-day scan-coverage gap (windows 10-12 incomplete); expected insufficient_evidence on history completeness.",
    addresses,
    events,
    scanCoverage,
    expected: {
      decision: "insufficient_evidence",
      reasonCodes: ["policy_history_incomplete"],
      classification: { included: 54, excluded: {}, adjustments: 0 },
      metrics: {
        completeWindows: 27,
        activePeriods: 27,
        incompleteWindows: 3,
        totalEligibleWholeUnits: 13500,
        topPayerShareBps: 6000,
        volatilityBps: 10000,
      },
    },
  });
}
