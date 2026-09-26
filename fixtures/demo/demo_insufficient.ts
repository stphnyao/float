import {
  buildAddressBook,
  buildFixture,
  EventFactory,
  fullCoverage,
  splitDailyTotal,
} from "../helpers.js";
import type { FixtureEvent, MerchantHistoryFixture } from "../types.js";

/**
 * demo_insufficient: only 6 active days out of a 30-day scanned span; volume
 * and concentration are within bounds but the active-period count is below
 * the frozen minimum. Expected: insufficient_evidence (never a guess).
 * Evidence mode: synthetic_fixture.
 */
export function buildDemoInsufficientFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xc1,
    treasurySeed: 0xc2,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [0xe1, 0xe2],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const events: FixtureEvent[] = [];
  const activeDays = [0, 3, 6, 9, 12, 15];
  for (const day of activeDays) {
    const parts = splitDailyTotal(250, [6000, 4000]); // 150 / 100
    parts.forEach((wholeUnits, payerIndex) => {
      events.push(
        factory.payment(day, addresses.payers[payerIndex]!, wholeUnits),
      );
    });
  }

  return buildFixture({
    name: "demo_insufficient",
    kind: "demo",
    description:
      "Only 6 active days in a fully scanned 30-day span; expected insufficient_evidence on the active-period minimum.",
    addresses,
    events,
    scanCoverage: fullCoverage(30),
    expected: {
      decision: "insufficient_evidence",
      reasonCodes: ["policy_insufficient_history_active_periods"],
      classification: { included: 12, excluded: {}, adjustments: 0 },
      metrics: {
        completeWindows: 30,
        activePeriods: 6,
        totalEligibleWholeUnits: 1500,
        topPayerShareBps: 6000,
        volatilityBps: 10000,
      },
    },
  });
}
