import {
  buildAddressBook,
  buildFixture,
  EventFactory,
  fullCoverage,
} from "../helpers.js";
import type { FixtureEvent, MerchantHistoryFixture } from "../types.js";

/**
 * Edge: self-funding. Thirty days of inflows, all from a declared
 * merchant-controlled address; every event is excluded as known self-funding,
 * so there is no eligible volume at all. Expected: insufficient_evidence with
 * no eligible receipts (never a guess). Evidence mode: synthetic_fixture.
 */
export function buildEdgeSelfFundingFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xd5,
    treasurySeed: 0xd6,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [],
    selfSourceSeeds: [0xf7],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const events: FixtureEvent[] = [];
  const [selfSource] = addresses.selfSources;
  for (let day = 0; day < 30; day += 1) {
    events.push(factory.payment(day, selfSource!, 600));
  }

  return buildFixture({
    name: "edge_self_funding",
    kind: "edge",
    description:
      "All inflows come from a declared merchant-controlled address (manufactured history); expected insufficient_evidence with zero eligible receipts.",
    addresses,
    events,
    scanCoverage: fullCoverage(30),
    expected: {
      decision: "insufficient_evidence",
      reasonCodes: [
        "policy_insufficient_history_active_periods",
        "policy_no_eligible_receipts",
      ],
      classification: {
        included: 0,
        excluded: { policy_excluded_known_self_funding: 30 },
        adjustments: 0,
      },
      metrics: {
        completeWindows: 30,
        activePeriods: 0,
        totalEligibleWholeUnits: 0,
        topPayerShareBps: 0,
        volatilityBps: 0,
      },
    },
  });
}
