import {
  buildAddressBook,
  buildFixture,
  EventFactory,
  fullCoverage,
  splitDailyTotal,
} from "../helpers.js";
import type { FixtureEvent, MerchantHistoryFixture } from "../types.js";

/**
 * demo_eligible: ~30 simulated days of varied, legitimate sales across five
 * independent payers, two zero-sales days included. Expected: eligible, sized
 * under policy-v1 defaults. Evidence mode: synthetic_fixture.
 */

// Daily totals in whole units (index = window/day). Two zero-sales days.
const DAILY_TOTALS = [
  520, 610, 480, 730, 590, 640, 700, 550, 660, 0, 810, 770, 690, 720, 850, 640,
  780, 560, 730, 880, 910, 0, 940, 870, 760, 990, 820, 1050, 930, 1120,
];
// Payer weights in bps: 30% / 25% / 20% / 15% / 10%.
const PAYER_WEIGHTS_BPS = [3000, 2500, 2000, 1500, 1000];

export function buildDemoEligibleFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xa1,
    treasurySeed: 0xa2,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [0xb1, 0xb2, 0xb3, 0xb4, 0xb5],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const events: FixtureEvent[] = [];
  for (let day = 0; day < DAILY_TOTALS.length; day += 1) {
    const total = DAILY_TOTALS[day]!;
    if (total === 0) continue;
    const parts = splitDailyTotal(total, PAYER_WEIGHTS_BPS);
    parts.forEach((wholeUnits, payerIndex) => {
      events.push(
        factory.payment(day, addresses.payers[payerIndex]!, wholeUnits),
      );
    });
  }

  return buildFixture({
    name: "demo_eligible",
    kind: "demo",
    description:
      "30 simulated days of varied legitimate sales across 5 payers with 2 zero-sales days; expected eligible and sized under policy-v1 defaults.",
    addresses,
    events,
    scanCoverage: fullCoverage(30),
    expected: {
      decision: "eligible",
      reasonCodes: ["policy_meets_all_thresholds"],
      classification: { included: 140, excluded: {}, adjustments: 0 },
      metrics: {
        completeWindows: 30,
        activePeriods: 28,
        totalEligibleWholeUnits: 21300,
        topPayerShareBps: 3000,
        volatilityBps: 14723,
        baselineWholeUnits: 610,
      },
      sizing: {
        perPeriodBudgetBaseUnits: "61000000",
        capacityBaseUnits: "854000000",
        principalBaseUnits: "427000000",
      },
    },
  });
}
