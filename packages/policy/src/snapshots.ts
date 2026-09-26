import {
  canonicalJson,
  formatMoneyAmount,
  parseMoneyAmount,
  revenueSnapshotSchema,
  type EventReference,
  type EvidenceMode,
  type MoneyAmount,
  type RevenueSnapshot,
  type RevenueWindow,
} from "@float/contracts";
import type { ClassifiedEvent, ClassificationResult } from "./classify.js";
import { eventRefKey } from "./classify.js";
import { deterministicUuid } from "./hash.js";
import {
  assertInteger,
  coverageCoversWindow,
  floorDiv,
  mergeCoverage,
  windowForIndex,
  windowIndexForTimestamp,
  type CoverageRange,
} from "./periods.js";
import { DEFAULT_PERIOD_SECONDS } from "./version.js";

/**
 * Snapshot building (docs/policy-v1.md sections 2, 4, 6). Classifies events
 * are grouped into anchored windows; windows are frozen snapshots. Late
 * refunds are append-only negative adjustments applied to the FIRST later
 * window that is not in the settled set; settled windows are never rewritten.
 */
export interface SnapshotBuildContext {
  /** Merchant identifier (UUID) stamped on every snapshot. */
  merchantId: string;
  chainId: number;
  /** Evidence mode carried onto every snapshot — never silently combined. */
  evidenceMode: EvidenceMode;
  /** Authorization-time anchor for period windows. */
  anchorSec: number;
  /** Evaluation time; windows ending after nowSec are not built. */
  nowSec: number;
  /** Period length in seconds; default 86,400. */
  periodSeconds?: number;
  /** Gap-free ingested ranges; a window is complete iff fully covered. */
  scanCoverage: CoverageRange[];
  /** Start seconds of already-settled windows that must never be rewritten. */
  settledWindowStartsSec?: number[];
  /** Snapshot creation time; defaults to nowSec. */
  createdAtSec?: number;
}

/** A refund that found no later unprocessed window; carried forward. */
export interface DeferredAdjustment {
  ref: EventReference;
  amountBaseUnits: MoneyAmount;
  originWindow: RevenueWindow;
  note: string;
}

export interface SnapshotBuildResult {
  classificationVersion: string;
  evidenceMode: EvidenceMode;
  snapshots: RevenueSnapshot[];
  deferredAdjustments: DeferredAdjustment[];
}

interface QueuedRefund {
  event: ClassifiedEvent;
  originIndex: number;
  originWindow: RevenueWindow;
}

const SNAPSHOT_ID_NAMESPACE = "float/policy/snapshot/v1";

export function buildRevenueSnapshots(
  classified: ClassificationResult,
  context: SnapshotBuildContext,
): SnapshotBuildResult {
  const periodSeconds = context.periodSeconds ?? DEFAULT_PERIOD_SECONDS;
  assertInteger(context.chainId, "chainId");
  assertInteger(context.anchorSec, "anchorSec");
  assertInteger(context.nowSec, "nowSec");
  assertInteger(periodSeconds, "periodSeconds");
  if (periodSeconds <= 0) throw new Error("periodSeconds must be positive");
  const createdAtSec = context.createdAtSec ?? context.nowSec;
  assertInteger(createdAtSec, "createdAtSec");

  const emptyResult: SnapshotBuildResult = {
    classificationVersion: classified.classificationVersion,
    evidenceMode: context.evidenceMode,
    snapshots: [],
    deferredAdjustments: [],
  };

  const mergedCoverage = mergeCoverage(context.scanCoverage);
  if (mergedCoverage.length === 0) return emptyResult;

  // Bucket events by window index.
  const eventsByIndex = new Map<number, ClassifiedEvent[]>();
  for (const event of classified.events) {
    const index = windowIndexForTimestamp(
      context.anchorSec,
      periodSeconds,
      event.timestampSec,
    );
    const bucket = eventsByIndex.get(index);
    if (bucket) bucket.push(event);
    else eventsByIndex.set(index, [event]);
  }

  // Build windows that intersect the coverage span and have ended by nowSec.
  const firstCoverage = mergedCoverage[0];
  const lastCoverage = mergedCoverage[mergedCoverage.length - 1];
  if (!firstCoverage || !lastCoverage) return emptyResult;
  const kMin = windowIndexForTimestamp(
    context.anchorSec,
    periodSeconds,
    firstCoverage.startSec,
  );
  const coverageKMax = windowIndexForTimestamp(
    context.anchorSec,
    periodSeconds,
    lastCoverage.endSec - 1,
  );
  // A window is finished iff its endSec <= nowSec, i.e. k <= floorDiv(now - anchor, P) - 1.
  const lastFinishedIndex =
    floorDiv(context.nowSec - context.anchorSec, periodSeconds) - 1;
  const kMax = Math.min(coverageKMax, lastFinishedIndex);

  const settledStarts = new Set(context.settledWindowStartsSec ?? []);
  const refundQueue: QueuedRefund[] = [];
  const deferredAdjustments: DeferredAdjustment[] = [];
  const snapshots: RevenueSnapshot[] = [];

  for (let k = kMin; k <= kMax; k += 1) {
    const window = windowForIndex(context.anchorSec, periodSeconds, k);
    const windowEvents = eventsByIndex.get(k) ?? [];

    const included: ClassifiedEvent[] = [];
    const excluded: ClassifiedEvent[] = [];
    for (const event of windowEvents) {
      if (event.outcome === "included") included.push(event);
      else excluded.push(event); // "excluded" and "adjustment" both list here by their reason
    }

    // Queue this window's refunds (they apply to a LATER window only).
    for (const event of excluded) {
      if (event.reasonCode === "policy_adjustment_refund") {
        refundQueue.push({ event, originIndex: k, originWindow: window });
      }
    }

    // Drain refunds whose origin is strictly earlier into the first
    // unprocessed window (this one, if it is not settled).
    const appliedAdjustments: QueuedRefund[] = [];
    if (!settledStarts.has(window.startSec)) {
      for (let i = refundQueue.length - 1; i >= 0; i -= 1) {
        const queued = refundQueue[i];
        if (queued && queued.originIndex < k) {
          appliedAdjustments.unshift(queued);
          refundQueue.splice(i, 1);
        }
      }
    }

    let net = 0n;
    for (const event of included)
      net += parseMoneyAmount(event.amountBaseUnits);
    for (const adjustment of appliedAdjustments) {
      net += parseMoneyAmount(adjustment.event.amountBaseUnits); // negative
    }

    const isComplete = coverageCoversWindow(mergedCoverage, window);
    const notes: string[] = [];
    if (!isComplete) {
      notes.push("coverage gap: window not fully covered by scan coverage");
    }
    if (appliedAdjustments.length > 0) {
      notes.push(
        `${appliedAdjustments.length} refund adjustment(s) applied from earlier window(s) (append-only)`,
      );
    }

    const snapshot = revenueSnapshotSchema.parse({
      id: deterministicUuid(
        SNAPSHOT_ID_NAMESPACE,
        canonicalJson({
          merchantId: context.merchantId,
          window,
          netEligibleAmount: formatMoneyAmount(net),
          included: included.map((e) => eventRefKey(e.ref)),
          excluded: excluded.map((e) => ({
            ref: eventRefKey(e.ref),
            reason: e.reasonCode,
          })),
          evidenceMode: context.evidenceMode,
          classificationVersion: classified.classificationVersion,
        }),
      ),
      merchantId: context.merchantId,
      window,
      includedEvents: included.map((e) => e.ref),
      excludedEvents: excluded.map((e) => ({
        ref: e.ref,
        reasonCode: e.reasonCode,
      })),
      netEligibleAmount: formatMoneyAmount(net),
      completeness: isComplete ? "complete" : "incomplete",
      completenessNotes: notes.join("; "),
      evidenceMode: context.evidenceMode,
      classificationVersion: classified.classificationVersion,
      createdAtSec,
    });
    snapshots.push(snapshot);
  }

  for (const queued of refundQueue) {
    deferredAdjustments.push({
      ref: queued.event.ref,
      amountBaseUnits: queued.event.amountBaseUnits,
      originWindow: queued.originWindow,
      note: `refund ${queued.event.ref.txHash}:${queued.event.ref.logIndex} has no later unprocessed window; carried forward until offset`,
    });
  }

  return {
    classificationVersion: classified.classificationVersion,
    evidenceMode: context.evidenceMode,
    snapshots,
    deferredAdjustments,
  };
}
