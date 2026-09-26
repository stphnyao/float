import {
  buildAddressBook,
  buildFixture,
  EventFactory,
  fullCoverage,
} from "../helpers.js";
import type { FixtureEvent, MerchantHistoryFixture } from "../types.js";

/**
 * demo_suspicious: steady legitimate sales from two payers, mixed with a
 * circular payer (the merchant pays cashbacks back to one of its "payers"
 * every day), a faucet distribution, a self-transfer, and known self-funding
 * inflows. Expected: declined for suspected circular flow. Evidence mode:
 * synthetic_fixture.
 */
export function buildDemoSuspiciousFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xb1,
    treasurySeed: 0xb2,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [0xc1, 0xc2, 0xc3],
    selfSourceSeeds: [0xd1],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const events: FixtureEvent[] = [];

  const [legitPayer1, legitPayer2, circularPayer] = addresses.payers;
  const [selfSource] = addresses.selfSources;

  // Legitimate payers: P1 alternates 380/420 daily; P2 pays 400 daily except days 9 and 21.
  for (let day = 0; day < 30; day += 1) {
    events.push(factory.payment(day, legitPayer1!, day % 2 === 1 ? 420 : 380));
    if (day !== 9 && day !== 21) {
      events.push(factory.payment(day, legitPayer2!, 400));
    }
  }
  // Circular pattern: C3 pays 500 daily (days 0..27) and receives 500 cashbacks (days 1..28).
  for (let day = 0; day < 28; day += 1) {
    events.push(factory.payment(day, circularPayer!, 500));
  }
  for (let day = 1; day < 29; day += 1) {
    events.push(factory.outgoing(day, circularPayer!, 500));
  }
  // Faucet distribution and a self-transfer.
  events.push(factory.payment(3, addresses.faucet, 1000));
  events.push(factory.payment(7, addresses.merchant, 250, addresses.merchant));
  // Known self-funding inflows.
  events.push(factory.payment(11, selfSource!, 800));
  events.push(factory.payment(17, selfSource!, 900));

  return buildFixture({
    name: "demo_suspicious",
    kind: "demo",
    description:
      "Legitimate sales mixed with daily circular cashbacks to payer C3, a faucet distribution, a self-transfer, and known self-funding; expected declined for suspected circular flow.",
    addresses,
    events,
    scanCoverage: fullCoverage(30),
    expected: {
      decision: "declined",
      reasonCodes: ["policy_suspicious_flow_detected"],
      classification: {
        included: 58,
        excluded: {
          policy_excluded_outgoing_transfer: 28,
          policy_excluded_suspected_circular: 28,
          policy_excluded_faucet_distribution: 1,
          policy_excluded_self_transfer: 1,
          policy_excluded_known_self_funding: 2,
        },
        adjustments: 0,
      },
      metrics: {
        completeWindows: 30,
        activePeriods: 30,
        totalEligibleWholeUnits: 23200,
        topPayerShareBps: 5172,
        volatilityBps: 10603,
      },
    },
  });
}
