/**
 * Deterministic fixture helpers. Integer math only; no floats, no randomness,
 * no clock, no runtime dependencies. Every builder produces the same output
 * on every call.
 */
import type {
  FixtureAddressBook,
  FixtureCoverageRange,
  FixtureEvent,
  FixtureExpected,
  FixtureSizingOverrides,
  MerchantHistoryFixture,
} from "./types.js";

export const FIXTURE_ANCHOR_SEC = 1758854400;
export const FIXTURE_PERIOD_SECONDS = 86400;
export const FIXTURE_TOKEN_DECIMALS = 6;
/** Arbitrary fixture-only chain id; NOT a claim about any real network. */
export const FIXTURE_CHAIN_ID = 42429;
export const FIXTURE_DAYS = 30;
/** Evaluation time: exactly the end of window 29, so windows 0..29 are finished. */
export const FIXTURE_NOW_SEC =
  FIXTURE_ANCHOR_SEC + FIXTURE_DAYS * FIXTURE_PERIOD_SECONDS;

export function fixtureAddress(seed: number): string {
  return `0x${seed.toString(16).padStart(40, "0")}`;
}

export function fixtureHash(seed: number): string {
  return `0x${seed.toString(16).padStart(64, "0")}`;
}

export function wholeToBaseUnits(whole: number): bigint {
  return BigInt(whole) * 10n ** BigInt(FIXTURE_TOKEN_DECIMALS);
}

export function wholeToBaseUnitsString(whole: number): string {
  return wholeToBaseUnits(whole).toString(10);
}

export function wholeToNegativeBaseUnitsString(whole: number): string {
  return `-${wholeToBaseUnits(whole).toString(10)}`;
}

export interface AddressBookSeeds {
  merchantSeed: number;
  treasurySeed: number;
  faucetSeed: number;
  tokenSeed: number;
  payerSeeds: number[];
  selfSourceSeeds?: number[];
  nonSaleSenderSeeds?: number[];
}

export function buildAddressBook(seeds: AddressBookSeeds): FixtureAddressBook {
  return {
    merchant: fixtureAddress(seeds.merchantSeed),
    treasury: fixtureAddress(seeds.treasurySeed),
    faucet: fixtureAddress(seeds.faucetSeed),
    token: fixtureAddress(seeds.tokenSeed),
    payers: seeds.payerSeeds.map(fixtureAddress),
    selfSources: (seeds.selfSourceSeeds ?? []).map(fixtureAddress),
    nonSaleSenders: (seeds.nonSaleSenderSeeds ?? []).map(fixtureAddress),
  };
}

/**
 * Splits a daily total across payer weights (bps) with integer floor
 * allocation; the rounding remainder goes to the LAST payer so the parts sum
 * exactly to the total. Deterministic, float-free.
 */
export function splitDailyTotal(total: number, weightsBps: number[]): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(
      `daily total must be a non-negative integer (got ${total})`,
    );
  }
  const parts = weightsBps.map((w) => Math.floor((total * w) / 10000));
  const assigned = parts.reduce((sum, value) => sum + value, 0);
  const lastIndex = parts.length - 1;
  parts[lastIndex] = parts[lastIndex]! + (total - assigned);
  return parts;
}

/**
 * Event factory: mints unique deterministic TransferEvents (each its own
 * transaction). Intra-day timestamps increase with the event counter so the
 * sort order within a day is builder order.
 */
export class EventFactory {
  private counter = 0;

  constructor(
    private readonly addresses: FixtureAddressBook,
    private readonly anchorSec: number,
  ) {}

  private nextTimestampSec(dayIndex: number): number {
    this.counter += 1;
    return (
      this.anchorSec +
      dayIndex * FIXTURE_PERIOD_SECONDS +
      600 +
      this.counter * 120
    );
  }

  /** Positive sale (or arbitrary positive transfer) into the merchant. */
  payment(
    dayIndex: number,
    from: string,
    wholeUnits: number,
    to?: string,
  ): FixtureEvent {
    const timestampSec = this.nextTimestampSec(dayIndex);
    return {
      chainId: FIXTURE_CHAIN_ID,
      txHash: fixtureHash(this.counter),
      logIndex: 0,
      blockNumber: this.counter,
      blockHash: fixtureHash(1_000_000 + this.counter),
      timestampSec,
      from,
      to: to ?? this.addresses.merchant,
      tokenAddress: this.addresses.token,
      amountBaseUnits: wholeToBaseUnitsString(wholeUnits),
    };
  }

  /** Canonical v1 refund: negative-amount event from the payer to the merchant. */
  refund(dayIndex: number, payer: string, wholeUnits: number): FixtureEvent {
    const timestampSec = this.nextTimestampSec(dayIndex);
    return {
      chainId: FIXTURE_CHAIN_ID,
      txHash: fixtureHash(this.counter),
      logIndex: 0,
      blockNumber: this.counter,
      blockHash: fixtureHash(1_000_000 + this.counter),
      timestampSec,
      from: payer,
      to: this.addresses.merchant,
      tokenAddress: this.addresses.token,
      amountBaseUnits: wholeToNegativeBaseUnitsString(wholeUnits),
    };
  }

  /** Outgoing transfer from the merchant to a recipient (e.g. cashbacks). */
  outgoing(dayIndex: number, to: string, wholeUnits: number): FixtureEvent {
    const timestampSec = this.nextTimestampSec(dayIndex);
    return {
      chainId: FIXTURE_CHAIN_ID,
      txHash: fixtureHash(this.counter),
      logIndex: 0,
      blockNumber: this.counter,
      blockHash: fixtureHash(1_000_000 + this.counter),
      timestampSec,
      from: this.addresses.merchant,
      to,
      tokenAddress: this.addresses.token,
      amountBaseUnits: wholeToBaseUnitsString(wholeUnits),
    };
  }
}

/** Full-window scan coverage: windows 0..(days-1) complete. */
export function fullCoverage(days: number): FixtureCoverageRange[] {
  return [
    {
      startSec: FIXTURE_ANCHOR_SEC,
      endSec: FIXTURE_ANCHOR_SEC + days * FIXTURE_PERIOD_SECONDS,
    },
  ];
}

export interface FixtureBuildInput {
  name: string;
  kind: "demo" | "edge";
  description: string;
  addresses: FixtureAddressBook;
  events: FixtureEvent[];
  scanCoverage?: FixtureCoverageRange[];
  settledWindowStartsSec?: number[];
  sizingOverrides?: FixtureSizingOverrides;
  expected: FixtureExpected;
}

export function buildFixture(input: FixtureBuildInput): MerchantHistoryFixture {
  return {
    name: input.name,
    kind: input.kind,
    description: input.description,
    evidenceMode: "synthetic_fixture",
    anchorSec: FIXTURE_ANCHOR_SEC,
    nowSec: FIXTURE_NOW_SEC,
    periodSeconds: FIXTURE_PERIOD_SECONDS,
    tokenDecimals: FIXTURE_TOKEN_DECIMALS,
    chainId: FIXTURE_CHAIN_ID,
    addresses: input.addresses,
    events: input.events,
    scanCoverage: input.scanCoverage ?? fullCoverage(FIXTURE_DAYS),
    settledWindowStartsSec: input.settledWindowStartsSec,
    sizingOverrides: input.sizingOverrides,
    expected: input.expected,
  };
}
