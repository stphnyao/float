/**
 * Fixture types. TYPE-ONLY imports from packages/contracts via relative path:
 * fixtures/ is a plain directory (not a pnpm workspace package), so relative
 * type imports keep it runtime-dependency-free while sharing the frozen DTO
 * shapes. See fixtures/README.md.
 */
import type { TransferEvent } from "../packages/contracts/src/revenue.js";
import type { EvidenceMode } from "../packages/contracts/src/evidence.js";
import type { OfferDecision } from "../packages/contracts/src/offer.js";

export type FixtureEvent = TransferEvent;
export type FixtureEvidenceMode = EvidenceMode; // always "synthetic_fixture" here
export type FixtureDecision = OfferDecision;

/** Recognized addresses for classification context. */
export interface FixtureAddressBook {
  merchant: string;
  treasury: string;
  faucet: string;
  token: string;
  payers: string[];
  /** Addresses declared merchant-controlled (self-funding). */
  selfSources: string[];
  /** Identified non-sale senders. */
  nonSaleSenders: string[];
}

export interface FixtureCoverageRange {
  startSec: number;
  endSec: number;
}

/** Expected classification counts per reason code. */
export interface FixtureExpectedClassification {
  included: number;
  /** reasonCode -> count */
  excluded: Record<string, number>;
  adjustments: number;
}

export interface FixtureExpectedMetrics {
  completeWindows: number;
  activePeriods: number;
  incompleteWindows?: number;
  totalEligibleWholeUnits: number;
  topPayerShareBps: number;
  volatilityBps: number;
  baselineWholeUnits?: number;
}

export interface FixtureExpectedSizing {
  perPeriodBudgetBaseUnits: string;
  capacityBaseUnits: string;
  principalBaseUnits: string;
}

export interface FixtureExpected {
  decision: FixtureDecision;
  reasonCodes: string[];
  classification: FixtureExpectedClassification;
  metrics?: FixtureExpectedMetrics;
  sizing?: FixtureExpectedSizing;
  /** Number of refunds left unapplied (carried forward). */
  deferredAdjustments?: number;
  /** Window index -> expected netEligibleAmount in whole units. */
  windowNetsWholeUnits?: Record<number, number>;
}

export interface FixtureSizingOverrides {
  collectionRateBps?: number;
  periodCeilingWholeUnits?: number;
  sizingHaircutBps?: number;
  maxPrincipalWholeUnits?: number;
  horizonPeriods?: number;
}

/**
 * A fully labeled, deterministic merchant history. Everything needed to
 * classify, snapshot, evaluate, and size — plus the expected results — lives
 * in the fixture itself.
 */
export interface MerchantHistoryFixture {
  name: string;
  kind: "demo" | "edge";
  description: string;
  evidenceMode: FixtureEvidenceMode;
  anchorSec: number;
  nowSec: number;
  periodSeconds: number;
  tokenDecimals: number;
  chainId: number;
  addresses: FixtureAddressBook;
  events: FixtureEvent[];
  scanCoverage: FixtureCoverageRange[];
  settledWindowStartsSec?: number[];
  sizingOverrides?: FixtureSizingOverrides;
  expected: FixtureExpected;
}
