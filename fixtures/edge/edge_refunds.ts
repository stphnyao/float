import {
  buildAddressBook,
  buildFixture,
  EventFactory,
  FIXTURE_ANCHOR_SEC,
  FIXTURE_PERIOD_SECONDS,
  fullCoverage,
} from "../helpers.js";
import type { FixtureEvent, MerchantHistoryFixture } from "../types.js";

function windowStart(index: number): number {
  return FIXTURE_ANCHOR_SEC + index * FIXTURE_PERIOD_SECONDS;
}

/** B1 pays 480 daily (30 days); B2 pays 400 on days 0..24. */
function buildBaseSales(
  factory: EventFactory,
  payer1: string,
  payer2: string,
): FixtureEvent[] {
  const events: FixtureEvent[] = [];
  for (let day = 0; day < 30; day += 1) {
    events.push(factory.payment(day, payer1, 480));
  }
  for (let day = 0; day < 25; day += 1) {
    events.push(factory.payment(day, payer2, 400));
  }
  return events;
}

/**
 * Edge: refunds against settled windows. Windows 0..19 are settled. A refund
 * on day 5 (a settled window) must be applied append-only to window 20 (the
 * first later unprocessed window); a refund on day 25 applies to window 26.
 * Settled windows keep their original nets. Expected: still eligible; sizing
 * principal capped by the absolute demo maximum. Evidence mode:
 * synthetic_fixture.
 */
export function buildEdgeRefundsFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xd7,
    treasurySeed: 0xd8,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [0xf8, 0xf9],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const [payer1, payer2] = addresses.payers;
  const events = buildBaseSales(factory, payer1!, payer2!);
  events.push(factory.refund(5, payer1!, 120)); // origin window 5 (settled)
  events.push(factory.refund(25, payer2!, 80)); // origin window 25 (unprocessed)

  const settledWindowStartsSec = Array.from({ length: 20 }, (_, k) =>
    windowStart(k),
  );

  return buildFixture({
    name: "edge_refunds",
    kind: "edge",
    description:
      "Refunds in settled windows are deferred to the first later unprocessed window (day 5 -> window 20, day 25 -> window 26); settled windows are never rewritten; expected eligible.",
    addresses,
    events,
    scanCoverage: fullCoverage(30),
    settledWindowStartsSec,
    expected: {
      decision: "eligible",
      reasonCodes: ["policy_meets_all_thresholds"],
      classification: { included: 55, excluded: {}, adjustments: 2 },
      metrics: {
        completeWindows: 30,
        activePeriods: 30,
        totalEligibleWholeUnits: 24200,
        topPayerShareBps: 5901,
        volatilityBps: 10909,
        baselineWholeUnits: 880,
      },
      sizing: {
        perPeriodBudgetBaseUnits: "88000000",
        capacityBaseUnits: "1232000000",
        principalBaseUnits: "500000000",
      },
      deferredAdjustments: 0,
      windowNetsWholeUnits: { 5: 880, 20: 760, 26: 400 },
    },
  });
}

/**
 * Edge: refund with no later unprocessed window. All 30 windows are settled,
 * so the day-10 refund cannot be applied anywhere and stays deferred
 * (carried forward until offset); every window keeps its original net.
 * Expected: still eligible. Evidence mode: synthetic_fixture.
 */
export function buildEdgeRefundDeferredFixture(): MerchantHistoryFixture {
  const addresses = buildAddressBook({
    merchantSeed: 0xdb,
    treasurySeed: 0xdc,
    faucetSeed: 0xfa,
    tokenSeed: 0x7e,
    payerSeeds: [0xfb, 0xfc],
  });
  const factory = new EventFactory(addresses, 1758854400);
  const [payer1, payer2] = addresses.payers;
  const events = buildBaseSales(factory, payer1!, payer2!);
  events.push(factory.refund(10, payer1!, 150)); // every later window is settled

  const settledWindowStartsSec = Array.from({ length: 30 }, (_, k) =>
    windowStart(k),
  );

  return buildFixture({
    name: "edge_refund_deferred",
    kind: "edge",
    description:
      "A refund in an all-settled series has no later unprocessed window and is carried forward as a deferred adjustment; no window is rewritten; expected eligible.",
    addresses,
    events,
    scanCoverage: fullCoverage(30),
    settledWindowStartsSec,
    expected: {
      decision: "eligible",
      reasonCodes: ["policy_meets_all_thresholds"],
      classification: { included: 55, excluded: {}, adjustments: 1 },
      metrics: {
        completeWindows: 30,
        activePeriods: 30,
        totalEligibleWholeUnits: 24400,
        topPayerShareBps: 5901,
        volatilityBps: 10819,
        baselineWholeUnits: 880,
      },
      sizing: {
        perPeriodBudgetBaseUnits: "88000000",
        capacityBaseUnits: "1232000000",
        principalBaseUnits: "500000000",
      },
      deferredAdjustments: 1,
      windowNetsWholeUnits: { 10: 880 },
    },
  });
}
