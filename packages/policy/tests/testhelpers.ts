import type { MerchantHistoryFixture } from "../../../fixtures/types.js";
import {
  buildRevenueSnapshots,
  classifyEvents,
  evaluateEligibility,
  policyDefaultSizingInputs,
  sizeOfferForDecision,
  type ClassificationContext,
  type ClassificationResult,
  type EligibilityResult,
  type SnapshotBuildResult,
  type SizingInputs,
} from "../src/index.js";

/** Fixed demo merchant id (v4-shaped UUID, deterministic). */
export const DEMO_MERCHANT_ID = "0b8f9a10-0000-4000-8000-0000000000c1";

export function fixtureClassificationContext(
  fixture: MerchantHistoryFixture,
): ClassificationContext {
  return {
    chainId: fixture.chainId,
    merchantAddress: fixture.addresses.merchant,
    tokenAddress: fixture.addresses.token,
    treasuryAddress: fixture.addresses.treasury,
    faucetSenders: [fixture.addresses.faucet],
    knownSelfFundingSources: fixture.addresses.selfSources,
    knownNonSaleSenders: fixture.addresses.nonSaleSenders,
    priorIncludedPayers: [],
    seenEventRefs: [],
  };
}

export interface FixturePipeline {
  classification: ClassificationResult;
  build: SnapshotBuildResult;
  eligibility: EligibilityResult;
  runsSizing: boolean;
}

/** Full deterministic pipeline for one fixture under policy-v1 defaults. */
export function runFixturePipeline(
  fixture: MerchantHistoryFixture,
  sizingInputs?: SizingInputs,
): FixturePipeline {
  const classification = classifyEvents(
    fixture.events,
    fixtureClassificationContext(fixture),
  );
  const build = buildRevenueSnapshots(classification, {
    merchantId: DEMO_MERCHANT_ID,
    chainId: fixture.chainId,
    evidenceMode: fixture.evidenceMode,
    anchorSec: fixture.anchorSec,
    nowSec: fixture.nowSec,
    periodSeconds: fixture.periodSeconds,
    scanCoverage: fixture.scanCoverage,
    settledWindowStartsSec: fixture.settledWindowStartsSec ?? [],
  });
  const eligibility = evaluateEligibility({
    snapshots: build.snapshots,
    classified: classification.events,
    tokenDecimals: fixture.tokenDecimals,
    evidenceMode: fixture.evidenceMode,
  });
  sizeOfferForDecision(
    eligibility,
    build.snapshots,
    sizingInputs ?? policyDefaultSizingInputs(fixture.tokenDecimals),
  );
  return {
    classification,
    build,
    eligibility,
    runsSizing: eligibility.decision === "eligible",
  };
}
