import {
  buildAddressBook,
  buildFixture,
  EventFactory,
  fullCoverage,
  splitDailyTotal,
} from "../helpers.js";
import type { FixtureEvent, MerchantHistoryFixture } from "../types.js";

/**
 * Edge: inactivity. Sales only in the first 10 days, then 20 zero-sales days
 * inside a fully scanned 30-day span. Two payers at 60/40 keep concentration
 * exactly at (not above) the cap, so the failure is purely the active-period
 * minimum. Expected: insufficient_evidence. Evidence mode: synthetic_fixture.
 */
export function buildEdgeInactivityFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xe1,
    treasurySeed: 0xe2,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [0xf1, 0xf2],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const events: FixtureEvent[] = [];
  for (let day = 0; day < 10; day += 1) {
    const parts = splitDailyTotal(1000, [6000, 4000]); // 600 / 400
    parts.forEach((wholeUnits, payerIndex) => {
      events.push(
        factory.payment(day, addresses.payers[payerIndex]!, wholeUnits),
      );
    });
  }

  return buildFixture({
    name: "edge_inactivity",
    kind: "edge",
    description:
      "Sales in the first 10 days only, then 20 zero-sales days; expected insufficient_evidence on the active-period minimum (baseline includes the zero days and collapses to 0).",
    addresses,
    events,
    scanCoverage: fullCoverage(30),
    expected: {
      decision: "insufficient_evidence",
      reasonCodes: ["policy_insufficient_history_active_periods"],
      classification: { included: 20, excluded: {}, adjustments: 0 },
      metrics: {
        completeWindows: 30,
        activePeriods: 10,
        totalEligibleWholeUnits: 10000,
        topPayerShareBps: 6000,
        volatilityBps: 10000,
        baselineWholeUnits: 0,
      },
    },
  });
}
