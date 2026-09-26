/**
 * Deterministic, labeled merchant histories for the Float demo and edge-case
 * suite. All fixtures carry evidenceMode "synthetic_fixture" and embed their
 * expected classification, decision, metrics, and (where applicable) sizing
 * under policy-v1 defaults. Builders are pure functions: every call returns
 * fresh, identical data.
 */
import { buildDemoEligibleFixture } from "./demo/demo_eligible.js";
import { buildDemoInsufficientFixture } from "./demo/demo_insufficient.js";
import { buildDemoSuspiciousFixture } from "./demo/demo_suspicious.js";
import { buildEdgeConcentratedFixture } from "./edge/edge_concentrated.js";
import { buildEdgeInactivityFixture } from "./edge/edge_inactivity.js";
import { buildEdgeIncompleteHistoryFixture } from "./edge/edge_incomplete_history.js";
import {
  buildEdgeRefundDeferredFixture,
  buildEdgeRefundsFixture,
} from "./edge/edge_refunds.js";
import { buildEdgeSelfFundingFixture } from "./edge/edge_self_funding.js";
import { buildEdgeVolatilityFixture } from "./edge/edge_volatility.js";
import type { MerchantHistoryFixture } from "./types.js";

export {
  buildDemoEligibleFixture,
  buildDemoInsufficientFixture,
  buildDemoSuspiciousFixture,
  buildEdgeConcentratedFixture,
  buildEdgeInactivityFixture,
  buildEdgeIncompleteHistoryFixture,
  buildEdgeRefundDeferredFixture,
  buildEdgeRefundsFixture,
  buildEdgeSelfFundingFixture,
  buildEdgeVolatilityFixture,
};

export const DEMO_FIXTURE_BUILDERS = [
  buildDemoEligibleFixture,
  buildDemoSuspiciousFixture,
  buildDemoInsufficientFixture,
];

export const EDGE_FIXTURE_BUILDERS = [
  buildEdgeConcentratedFixture,
  buildEdgeVolatilityFixture,
  buildEdgeSelfFundingFixture,
  buildEdgeRefundsFixture,
  buildEdgeRefundDeferredFixture,
  buildEdgeIncompleteHistoryFixture,
  buildEdgeInactivityFixture,
];

export const ALL_FIXTURE_BUILDERS: Array<() => MerchantHistoryFixture> = [
  ...DEMO_FIXTURE_BUILDERS,
  ...EDGE_FIXTURE_BUILDERS,
];

export type { MerchantHistoryFixture } from "./types.js";
