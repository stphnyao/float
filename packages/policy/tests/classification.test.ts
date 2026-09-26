import { describe, expect, it } from "vitest";
import type { TransferEvent } from "@float/contracts";
import {
  classifyEvents,
  eventRefKey,
  POLICY_VERSION,
  type ClassificationContext,
  type ClassifiedEvent,
} from "../src/index.js";

const MERCHANT = "0x00000000000000000000000000000000000000a1" as const;
const TREASURY = "0x00000000000000000000000000000000000000a2" as const;
const FAUCET = "0x00000000000000000000000000000000000000fa" as const;
const TOKEN = "0x000000000000000000000000000000000000007e" as const;
const OTHER_TOKEN = "0x0000000000000000000000000000000000000099" as const;
const PAYER = "0x00000000000000000000000000000000000000b1" as const;
const PAYER2 = "0x00000000000000000000000000000000000000b2" as const;
const SELF_SOURCE = "0x00000000000000000000000000000000000000c1" as const;
const NON_SALE = "0x00000000000000000000000000000000000000d1" as const;
const STRANGER = "0x00000000000000000000000000000000000000e1" as const;

function makeEvent(overrides: Partial<TransferEvent> = {}): TransferEvent {
  return {
    chainId: 42429,
    txHash: `0x${"11".repeat(32)}`,
    logIndex: 0,
    blockNumber: 1,
    blockHash: `0x${"22".repeat(32)}`,
    timestampSec: 1758854400,
    from: PAYER,
    to: MERCHANT,
    tokenAddress: TOKEN,
    amountBaseUnits: "1000000",
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<ClassificationContext> = {},
): ClassificationContext {
  return {
    chainId: 42429,
    merchantAddress: MERCHANT,
    tokenAddress: TOKEN,
    treasuryAddress: TREASURY,
    faucetSenders: [FAUCET],
    knownSelfFundingSources: [SELF_SOURCE],
    knownNonSaleSenders: [NON_SALE],
    priorIncludedPayers: [],
    seenEventRefs: [],
    ...overrides,
  };
}

function firstResult(
  events: TransferEvent[],
  context?: ClassificationContext,
): ClassifiedEvent {
  const result = classifyEvents(events, context ?? makeContext());
  expect(result.classificationVersion).toBe(POLICY_VERSION);
  return result.events[0]!;
}

describe("classifyEvents", () => {
  it("includes a plain sale with version and provenance", () => {
    const classified = firstResult([makeEvent()]);
    expect(classified.outcome).toBe("included");
    expect(classified.reasonCode).toBe("policy_included_eligible_sale");
    expect(classified.provenance).toContain(PAYER);
    expect(classified.classificationVersion).toBe(POLICY_VERSION);
  });

  it("excludes duplicates by (chainId, txHash, logIndex) within a batch", () => {
    const event = makeEvent();
    const result = classifyEvents([event, { ...event }], makeContext());
    expect(result.events.map((e) => e.reasonCode)).toEqual([
      "policy_included_eligible_sale",
      "policy_excluded_duplicate_event",
    ]);
  });

  it("excludes duplicates against context seenEventRefs", () => {
    const event = makeEvent();
    const context = makeContext({
      seenEventRefs: [
        {
          chainId: event.chainId,
          txHash: event.txHash,
          logIndex: event.logIndex,
        },
      ],
    });
    const classified = firstResult([event], context);
    expect(classified.reasonCode).toBe("policy_excluded_duplicate_event");
  });

  it("excludes untracked tokens before anything else except duplicates", () => {
    const classified = firstResult([
      makeEvent({ tokenAddress: OTHER_TOKEN, from: FAUCET }),
    ]);
    expect(classified.reasonCode).toBe("policy_excluded_untracked_token");
  });

  it("excludes transfers where the merchant is not a party", () => {
    const classified = firstResult([makeEvent({ from: STRANGER, to: PAYER2 })]);
    expect(classified.reasonCode).toBe("policy_excluded_unrelated_transfer");
  });

  it("excludes self-transfers", () => {
    const classified = firstResult([
      makeEvent({ from: MERCHANT, to: MERCHANT }),
    ]);
    expect(classified.reasonCode).toBe("policy_excluded_self_transfer");
  });

  it("excludes faucet distributions", () => {
    const classified = firstResult([makeEvent({ from: FAUCET })]);
    expect(classified.reasonCode).toBe("policy_excluded_faucet_distribution");
  });

  it("excludes Float treasury disbursements", () => {
    const classified = firstResult([makeEvent({ from: TREASURY })]);
    expect(classified.reasonCode).toBe("policy_excluded_float_disbursement");
  });

  it("excludes known self-funding sources", () => {
    const classified = firstResult([makeEvent({ from: SELF_SOURCE })]);
    expect(classified.reasonCode).toBe("policy_excluded_known_self_funding");
  });

  it("excludes identified non-sale senders", () => {
    const classified = firstResult([makeEvent({ from: NON_SALE })]);
    expect(classified.reasonCode).toBe("policy_excluded_identified_non_sale");
  });

  it("classifies refunds from prior payers as adjustments", () => {
    const context = makeContext({ priorIncludedPayers: [PAYER] });
    const classified = firstResult(
      [makeEvent({ amountBaseUnits: "-500000" })],
      context,
    );
    expect(classified.outcome).toBe("adjustment");
    expect(classified.reasonCode).toBe("policy_adjustment_refund");
  });

  it("classifies refunds against sales classified earlier in the batch", () => {
    const result = classifyEvents(
      [
        makeEvent({
          txHash: `0x${"aa".repeat(32)}`,
          timestampSec: 1000,
          amountBaseUnits: "700000",
        }),
        makeEvent({
          txHash: `0x${"bb".repeat(32)}`,
          timestampSec: 2000,
          amountBaseUnits: "-300000",
        }),
      ],
      makeContext(),
    );
    expect(result.events.map((e) => e.reasonCode)).toEqual([
      "policy_included_eligible_sale",
      "policy_adjustment_refund",
    ]);
  });

  it("excludes negative amounts with no matching eligible payer", () => {
    const classified = firstResult([
      makeEvent({ from: STRANGER, amountBaseUnits: "-500000" }),
    ]);
    expect(classified.reasonCode).toBe("policy_excluded_identified_non_sale");
  });

  it("excludes outgoing merchant transfers", () => {
    const classified = firstResult([makeEvent({ from: MERCHANT, to: PAYER })]);
    expect(classified.reasonCode).toBe("policy_excluded_outgoing_transfer");
  });

  it("excludes suspected circular payers regardless of batch order", () => {
    const sale = makeEvent({
      txHash: `0x${"aa".repeat(32)}`,
      timestampSec: 2000,
      from: PAYER,
    });
    const cashback = makeEvent({
      txHash: `0x${"bb".repeat(32)}`,
      timestampSec: 1000,
      from: MERCHANT,
      to: PAYER,
    });
    for (const batch of [
      [sale, cashback],
      [cashback, sale],
    ]) {
      const result = classifyEvents(batch, makeContext());
      expect(result.events.map((e) => e.reasonCode).sort()).toEqual([
        "policy_excluded_outgoing_transfer",
        "policy_excluded_suspected_circular",
      ]);
    }
  });

  it("is independent of input batch order (fully shuffled batches classify identically)", () => {
    const events = [
      makeEvent({ txHash: `0x${"01".repeat(32)}`, timestampSec: 3000 }),
      makeEvent({
        txHash: `0x${"02".repeat(32)}`,
        timestampSec: 1000,
        from: FAUCET,
      }),
      makeEvent({
        txHash: `0x${"03".repeat(32)}`,
        timestampSec: 5000,
        from: MERCHANT,
        to: PAYER2,
      }),
      makeEvent({
        txHash: `0x${"04".repeat(32)}`,
        timestampSec: 4000,
        amountBaseUnits: "-100000",
      }),
      makeEvent({
        txHash: `0x${"05".repeat(32)}`,
        timestampSec: 2000,
        from: NON_SALE,
      }),
    ];
    const forward = classifyEvents(events, makeContext());
    const backward = classifyEvents([...events].reverse(), makeContext());
    expect(backward).toEqual(forward);
    expect(forward.events.map((e) => eventRefKey(e.ref))).toEqual(
      [...forward.events]
        .sort((a, b) => a.timestampSec - b.timestampSec)
        .map((e) => eventRefKey(e.ref)),
    );
  });

  it("rejects events that violate the frozen TransferEvent contract", () => {
    expect(() =>
      classifyEvents([makeEvent({ amountBaseUnits: "1.5" })], makeContext()),
    ).toThrow();
    expect(() =>
      classifyEvents([makeEvent({ txHash: "0x1234" })], makeContext()),
    ).toThrow();
  });
});
