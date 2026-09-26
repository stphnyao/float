import {
  buildAddressBook,
  buildFixture,
  EventFactory,
  fullCoverage,
  splitDailyTotal,
} from "../helpers.js";
import type { FixtureEvent, MerchantHistoryFixture } from "../types.js";

/**
 * Edge: concentrated but legitimate revenue. Steady daily sales with one payer
 * providing 85% of volume — everything else within bounds, but the top-payer
 * share exceeds the frozen 6000 bps cap. Expected: declined. Evidence mode:
 * synthetic_fixture.
 */
export function buildEdgeConcentratedFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xd1,
    treasurySeed: 0xd2,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [0xf1, 0xf2],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const events: FixtureEvent[] = [];
  for (let day = 0; day < 30; day += 1) {
    if (day === 9 || day === 21) continue; // two zero-sales days
    const parts = splitDailyTotal(700, [8500, 1500]); // 595 / 105
    parts.forEach((wholeUnits, payerIndex) => {
      events.push(
        factory.payment(day, addresses.payers[payerIndex]!, wholeUnits),
      );
    });
  }

  return buildFixture({
    name: "edge_concentrated",
    kind: "edge",
    description:
      "Concentrated but legitimate revenue: one payer provides 85% of steady volume; expected declined on the concentration cap.",
    addresses,
    events,
    scanCoverage: fullCoverage(30),
    expected: {
      decision: "declined",
      reasonCodes: ["policy_payer_concentration_above_cap"],
      classification: { included: 56, excluded: {}, adjustments: 0 },
      metrics: {
        completeWindows: 30,
        activePeriods: 28,
        totalEligibleWholeUnits: 19600,
        topPayerShareBps: 8500,
        volatilityBps: 10000,
      },
    },
  });
}
