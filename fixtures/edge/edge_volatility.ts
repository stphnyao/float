import {
  buildAddressBook,
  buildFixture,
  EventFactory,
  fullCoverage,
} from "../helpers.js";
import type { FixtureEvent, MerchantHistoryFixture } from "../types.js";

/**
 * Edge: high volatility. One 20,000-unit day against a 200-unit/day baseline
 * (rotated across four payers so concentration stays in bounds). Expected:
 * declined on the volatility bound. Evidence mode: synthetic_fixture.
 */
export function buildEdgeVolatilityFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xd3,
    treasurySeed: 0xd4,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [0xf3, 0xf4, 0xf5, 0xf6],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const events: FixtureEvent[] = [];
  for (let day = 0; day < 30; day += 1) {
    if (day === 12) {
      // Spike day, split across three payers to keep concentration in bounds.
      events.push(factory.payment(day, addresses.payers[0]!, 8000));
      events.push(factory.payment(day, addresses.payers[1]!, 7000));
      events.push(factory.payment(day, addresses.payers[2]!, 5000));
      continue;
    }
    events.push(factory.payment(day, addresses.payers[day % 4]!, 200));
  }

  return buildFixture({
    name: "edge_volatility",
    kind: "edge",
    description:
      "One 20,000-unit spike day against a 200-unit/day baseline; expected declined on the volatility bound.",
    addresses,
    events,
    scanCoverage: fullCoverage(30),
    expected: {
      decision: "declined",
      reasonCodes: ["policy_volatility_above_cap"],
      classification: { included: 32, excluded: {}, adjustments: 0 },
      metrics: {
        completeWindows: 30,
        activePeriods: 30,
        totalEligibleWholeUnits: 25800,
        topPayerShareBps: 3643,
        volatilityBps: 232558,
      },
    },
  });
}
