import {
  getBudgetForPeriodStart,
  getCoverage,
  getSnapshotForWindowStart,
  listFrozenWindowStartsSec,
  listOpenAdvances,
  loadEventsForMerchant,
  persistSnapshot,
  supersedeExpiredBudgets,
  createBudgetForPeriod,
  type AdvanceRow,
} from "@float/db";
import { floorDiv } from "@float/policy";
import type { WorkerContext } from "../context.js";

export interface CreateBudgetsResult {
  job: "createBudgets";
  snapshotsFrozen: number;
  budgetsCreated: number;
  advancesConsidered: number;
}

/**
 * Last index k with a COMPLETED receipt window
 * (window k = [anchor + k*P, anchor + (k+1)*P) ended by nowSec).
 */
export function lastCompletedWindowIndex(
  anchorSec: number,
  periodSeconds: number,
  nowSec: number,
): number {
  return floorDiv(nowSec - anchorSec, periodSeconds) - 1;
}

/**
 * Builds revenue snapshots for the advance's completed post-funding windows
 * and freezes collection budgets for every period p >= 1 whose receipts
 * window p-1 completed with a COMPLETE snapshot (p <= floorDiv(now-anchor, P),
 * i.e. including the CURRENT period, which collects on the preceding
 * window's receipts):
 *
 *   budget[p] = min(floor(rate_bps * max(0, eligible_receipts[p-1]) / 10000),
 *                   agreed_period_ceiling,
 *                   outstanding_at_budget_creation)
 *
 * (formula applied inside db.createBudgetForPeriod). Windows whose scan
 * coverage is incomplete are NOT frozen and get NO budget — the health job
 * pauses the advance (COLLECTION_SCAN_INCOMPLETE) rather than reusing stale
 * totals. Pre-funding windows (negative indices) are never built: pre-funding
 * sales may support an offer but never become repayment receipts.
 */
export async function createBudgets(
  ctx: WorkerContext,
): Promise<CreateBudgetsResult> {
  const nowSec = ctx.nowSec();
  const nowDate = new Date(nowSec * 1000);
  const advances = (await listOpenAdvances(ctx.db)).filter(
    (advance) => advance.state !== "funding_pending",
  );

  let snapshotsFrozen = 0;
  let budgetsCreated = 0;

  for (const advance of advances) {
    const anchorSec = Math.floor(advance.periodAnchor.getTime() / 1000);
    const periodSeconds = advance.periodSeconds;
    const kCompletedMax = lastCompletedWindowIndex(
      anchorSec,
      periodSeconds,
      nowSec,
    );

    const observed = await getCoverage(
      ctx.db,
      advance.tokenChainId,
      advance.tokenAddress,
    );
    // Receipts are evaluated only from the funding anchor forward, so the
    // coverage range used for completeness starts no later than the anchor.
    // The end is the observed coverage end (conservative: a quiet tail after
    // the last ingested event leaves later windows incomplete until new
    // activity anchors them).
    const coverage = observed
      ? {
          startSec: Math.min(observed.startSec, anchorSec),
          endSec: observed.endSec,
        }
      : null;
    const events = await loadEventsForMerchant(ctx.db, {
      chainId: advance.tokenChainId,
      tokenAddress: advance.tokenAddress,
      merchantAddress: advance.merchantAddress,
      fromSec: anchorSec,
      toSec: nowSec,
    });
    const settledWindowStartsSec = await listFrozenWindowStartsSec(
      ctx.db,
      advance.merchantId,
    );

    const built = ctx.pipeline.buildSnapshots({
      merchantId: advance.merchantId,
      anchorSec,
      nowSec,
      periodSeconds,
      coverage,
      settledWindowStartsSec,
      events,
    });

    for (const snapshot of built.snapshots) {
      const created = await persistSnapshot(
        ctx.db,
        {
          id: snapshot.id,
          merchantId: advance.merchantId,
          windowStartSec: snapshot.windowStartSec,
          windowEndSec: snapshot.windowEndSec,
          netEligibleAmount: BigInt(snapshot.netEligibleAmount),
          completeness: snapshot.completeness,
          completenessNotes: snapshot.completenessNotes,
          evidenceMode: ctx.evidenceMode,
          classificationVersion: ctx.pipeline.classificationVersion,
          includedEvents: snapshot.includedEvents,
          excludedEvents: snapshot.excludedEvents,
        },
        snapshot.events.map((event) => ({
          ref: event.ref,
          eligible: event.outcome === "included",
          reasonCode: event.reasonCode,
          provenance: event.provenance,
          evidenceMode: ctx.evidenceMode,
        })),
      );
      if (created) snapshotsFrozen += 1;
    }

    budgetsCreated += await createMissingBudgets(
      ctx,
      advance,
      kCompletedMax + 1,
    );
    // Unused expired budgets never accumulate as catch-up charges.
    await supersedeExpiredBudgets(ctx.db, advance.id, nowDate);
  }

  return {
    job: "createBudgets",
    snapshotsFrozen,
    budgetsCreated,
    advancesConsidered: advances.length,
  };
}

async function createMissingBudgets(
  ctx: WorkerContext,
  advance: AdvanceRow,
  kCompletedMax: number,
): Promise<number> {
  let created = 0;
  const periodSeconds = advance.periodSeconds;
  const anchorSec = Math.floor(advance.periodAnchor.getTime() / 1000);
  for (let p = 1; p <= kCompletedMax; p += 1) {
    const periodStartSec = anchorSec + p * periodSeconds;
    const existing = await getBudgetForPeriodStart(
      ctx.db,
      advance.id,
      periodStartSec,
    );
    if (existing) continue;
    const snapshot = await getSnapshotForWindowStart(
      ctx.db,
      advance.merchantId,
      periodStartSec - periodSeconds,
    );
    if (!snapshot || snapshot.completeness !== "complete") continue;
    const { created: wasCreated } = await createBudgetForPeriod(ctx.db, {
      advanceId: advance.id,
      periodStartSec,
      periodEndSec: periodStartSec + periodSeconds,
      eligibleReceiptsAmount: snapshot.netEligibleAmount,
      rateBps: advance.collectionRateBps,
      ceilingAmount: advance.periodCeilingAmount,
      outstandingAtCreation: advance.confirmedOutstandingAmount,
      snapshotId: snapshot.id,
    });
    if (wasCreated) created += 1;
  }
  return created;
}
