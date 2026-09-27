import { expect } from "vitest";
import {
  acceptOffer,
  insertOffer,
  type AdvanceRow,
  type OfferRow,
} from "@float/db";
import type { OfferTerms } from "@float/contracts";
import {
  createWorkerContext,
  loadWorkerConfig,
  type ReceiptPipeline,
  type WorkerContext,
} from "@float/worker";
import {
  FakeTempoAdapter,
  fakeEvent,
  type FakeLedgerEvent,
} from "../fakes/fakeTempoAdapter.js";
import type { TestDb } from "./testdb.js";

/**
 * Deterministic test universe. Periods are ACCELERATED (3600 s) simulated
 * windows driven by an injected clock — a test convenience, explicitly NOT
 * evidence of a 24-hour chain rollover (PLAN section 3). Token decimals are
 * the TIP-20 standard 6 proven by the G1 spike.
 */
export const CHAIN_ID = 42431; // Tempo Moderato testnet (G1 spike)
export const DECIMALS = 6;
export const PERIOD_SECONDS = 3600; // accelerated simulated period (tests only)
export const ANCHOR_SEC = 1_758_854_400; // fixed epoch for deterministic windows

export const MERCHANT = addr(0xa11);
export const MERCHANT_2 = addr(0xa12);
export const TREASURY = addr(0xfee1);
export const TOKEN = addr(0x7e3c);
export const PAYER_1 = addr(0xb001);
export const PAYER_2 = addr(0xb002);
export const FAUCET = addr(0xfa00);

export function addr(seed: number): string {
  return `0x${seed.toString(16).padStart(40, "0")}`;
}

export function wholeUnits(whole: number): string {
  return (BigInt(whole) * 10n ** BigInt(DECIMALS)).toString(10);
}

/** A sale into the merchant at `timeSec` (unique tx per call). */
export function sale(
  timeSec: number,
  payer: string,
  wholeUnitsAmount: number,
  merchant: string = MERCHANT,
): FakeLedgerEvent {
  return fakeEvent({
    timestampSec: timeSec,
    from: payer,
    to: merchant,
    tokenAddress: TOKEN,
    amountBaseUnits: wholeUnits(wholeUnitsAmount),
  });
}

/** A refund OUT of the merchant to a payer (real direction on chain). */
export function refund(
  timeSec: number,
  payer: string,
  wholeUnitsAmount: number,
  merchant: string = MERCHANT,
): FakeLedgerEvent {
  return fakeEvent({
    timestampSec: timeSec,
    from: merchant,
    to: payer,
    tokenAddress: TOKEN,
    amountBaseUnits: wholeUnits(wholeUnitsAmount),
  });
}

/** Any non-sale inflow (e.g. faucet drip) that still anchors scan coverage. */
export function drip(
  timeSec: number,
  wholeUnitsAmount = 1,
  merchant: string = MERCHANT,
): FakeLedgerEvent {
  return fakeEvent({
    timestampSec: timeSec,
    from: FAUCET,
    to: merchant,
    tokenAddress: TOKEN,
    amountBaseUnits: wholeUnits(wholeUnitsAmount),
  });
}

/** Canonical on-chain time of an event inside simulated window k. */
export function windowTimeSec(windowIndex: number): number {
  return ANCHOR_SEC + windowIndex * PERIOD_SECONDS + 600;
}

/** A sale inside simulated window k. */
export function saleInWindow(
  windowIndex: number,
  wholeUnitsAmount: number,
  payer = PAYER_1,
  merchant: string = MERCHANT,
): FakeLedgerEvent {
  return sale(windowTimeSec(windowIndex), payer, wholeUnitsAmount, merchant);
}

/** A drip inside simulated window k (coverage anchor, zero revenue). */
export function dripInWindow(
  windowIndex: number,
  merchant: string = MERCHANT,
): FakeLedgerEvent {
  return drip(windowTimeSec(windowIndex), 1, merchant);
}

/** A refund inside simulated window k (merchant -> payer on chain). */
export function refundInWindow(
  windowIndex: number,
  payer: string,
  wholeUnitsAmount: number,
  merchant: string = MERCHANT,
): FakeLedgerEvent {
  return refund(windowTimeSec(windowIndex), payer, wholeUnitsAmount, merchant);
}

export interface SeedOptions {
  merchantWalletAddress?: string;
  principalWhole?: number;
  rateBps?: number;
  ceilingWhole?: number;
  decision?: "eligible" | "declined" | "insufficient_evidence";
  state?: "offered" | "accepted" | "expired" | "declined";
  expiresInSeconds?: number;
}

export async function seedOffer(
  testDb: TestDb,
  opts: SeedOptions = {},
): Promise<OfferRow> {
  const principalWhole = opts.principalWhole ?? 100;
  const terms: OfferTerms = {
    token: { chainId: CHAIN_ID, address: TOKEN, decimals: DECIMALS },
    treasuryAddress: TREASURY,
    principalAmount: wholeUnits(principalWhole),
    totalObligationAmount: wholeUnits(principalWhole),
    collectionRateBps: opts.rateBps ?? 1000,
    periodCeilingAmount: wholeUnits(opts.ceilingWhole ?? 20),
    periodSeconds: PERIOD_SECONDS,
    authorizationExpirySec: ANCHOR_SEC + 30 * 86_400,
    estimatedCollectionHorizonSec: 14 * PERIOD_SECONDS,
    maxPrincipalAmount: wholeUnits(500),
    sizingHaircutBps: 5000,
  };
  return insertOffer(testDb.db, {
    merchantWalletAddress: opts.merchantWalletAddress ?? MERCHANT,
    terms,
    policyVersion: "policy-v1",
    snapshotIds: [],
    decision: opts.decision ?? "eligible",
    reasonCodes: ["policy_meets_all_thresholds"],
    evidenceMode: "synthetic_fixture",
    state: opts.state,
    now: new Date((ANCHOR_SEC - 120) * 1000),
    ttlSec: opts.expiresInSeconds ?? 86_400,
  });
}

export async function acceptSeedOffer(
  testDb: TestDb,
  offer: OfferRow,
  opts: {
    atSec?: number;
    withAuthorization?: boolean;
    /** Authenticated wallet expected to own the offer (defaults to MERCHANT). */
    expectedWallet?: string;
  } = {},
): Promise<{
  advance: AdvanceRow;
  fundingIntentId: string;
  replayed: boolean;
}> {
  const expectedWallet = opts.expectedWallet ?? MERCHANT;
  return acceptOffer(testDb.db, {
    offerId: offer.id,
    termsHash: offer.termsHash,
    now: new Date((opts.atSec ?? ANCHOR_SEC) * 1000),
    expectedMerchantWalletAddress: expectedWallet,
    authorization:
      opts.withAuthorization === false
        ? undefined
        : {
            chainId: CHAIN_ID,
            tokenAddress: TOKEN,
            chainAccountAddress: expectedWallet,
            keyAddress: addr(0xa001),
            keyPublicKey: null,
            scopes: [
              {
                contractAddress: TOKEN,
                selector: "transfer",
                recipients: [TREASURY],
              },
            ],
            periodSeconds: PERIOD_SECONDS,
            periodCeilingAmount: wholeUnits(20),
            expirySec: ANCHOR_SEC + 30 * 86_400,
            authorizationTxHash: `0x${"a".repeat(64)}`,
            witness: null,
          },
  });
}

/**
 * Full worker context on the fake chain: injectable clock, policy-v1 default
 * pipeline unless overridden. Asserts (once per file) that the adapter is
 * REALLY the fake — fakes must be visibly identified (PLAN section 5).
 */
export interface Harness {
  ctx: WorkerContext;
  adapter: FakeTempoAdapter;
  clock: { now: number };
  setTime(sec: number): void;
}

let seedCounter = 0;

export interface SeedAndHarness {
  harness: Harness;
  advance: AdvanceRow;
  offer: OfferRow;
  /** The merchant wallet EVERYTHING in this scenario must use. */
  wallet: string;
  /** The delegated key address of the confirmed authorization. */
  keyAddress: string;
}

/**
 * One self-contained scenario: a fresh merchant wallet + eligible offer +
 * accepted advance (with a confirmed authorization on its own delegated
 * key), and a harness whose config.merchantAddress IS that wallet — so the
 * event builders must target `wallet` and everything lines up.
 */
export async function seedAdvanceHarness(
  testDb: TestDb,
  opts: SeedOptions & {
    atSec?: number;
    withAuthorization?: boolean;
    pipeline?: ReceiptPipeline;
  } = {},
): Promise<SeedAndHarness> {
  seedCounter += 1;
  const wallet = opts.merchantWalletAddress ?? addr(0xd000 + seedCounter);
  const keyAddress = addr(0xa000 + seedCounter);
  const harness = makeHarness(testDb, {
    merchantAddress: wallet,
    pipeline: opts.pipeline,
  });
  const offer = await seedOffer(testDb, {
    ...opts,
    merchantWalletAddress: wallet,
  });
  const accepted = await acceptOffer(testDb.db, {
    offerId: offer.id,
    termsHash: offer.termsHash,
    now: new Date((opts.atSec ?? ANCHOR_SEC) * 1000),
    expectedMerchantWalletAddress: wallet,
    authorization:
      opts.withAuthorization === false
        ? undefined
        : {
            chainId: CHAIN_ID,
            tokenAddress: TOKEN,
            chainAccountAddress: wallet,
            keyAddress,
            keyPublicKey: null,
            scopes: [
              {
                contractAddress: TOKEN,
                selector: "transfer",
                recipients: [TREASURY],
              },
            ],
            periodSeconds: PERIOD_SECONDS,
            periodCeilingAmount: wholeUnits(opts.ceilingWhole ?? 20),
            expirySec: ANCHOR_SEC + 30 * 86_400,
            authorizationTxHash: `0x${"a".repeat(64)}`,
            witness: null,
          },
  });
  return {
    harness,
    advance: accepted.advance,
    offer,
    wallet,
    keyAddress,
  };
}

export function makeHarness(
  testDb: TestDb,
  opts: { pipeline?: WorkerContext["pipeline"]; merchantAddress?: string } = {},
): Harness {
  const adapter = new FakeTempoAdapter(CHAIN_ID);
  const clock = { now: ANCHOR_SEC };
  adapter.nowSec = () => clock.now;
  const baseConfig = loadWorkerConfig({});
  const config = {
    ...baseConfig,
    databaseUrl: "unused-by-tests",
    chain: {
      chainId: CHAIN_ID,
      rpcUrl: "fake://rpc",
      explorerUrl: null,
      tokenAddress: TOKEN,
    },
    merchantAddress: opts.merchantAddress ?? MERCHANT,
    treasuryAddress: TREASURY,
    faucetSenders: [FAUCET],
    knownSelfFundingSources: [],
    knownNonSaleSenders: [],
    ingestStartBlock: 0,
    pollIntervalMs: 1000,
  };
  const ctx = createWorkerContext({
    db: testDb.db,
    adapter,
    config,
    pipeline: opts.pipeline,
    nowSec: () => clock.now,
  });
  expect(adapter.implementation).toBe("fake");
  expect(ctx.evidenceMode).toBe("synthetic_fixture");
  return {
    ctx,
    adapter,
    clock,
    setTime(sec: number) {
      clock.now = sec;
    },
  };
}
