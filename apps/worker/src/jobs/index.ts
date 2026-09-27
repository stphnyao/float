import type { WorkerContext } from "../context.js";
import { ingestReceipts } from "./ingestReceipts.js";
import { createBudgets } from "./createBudgets.js";
import { fundAdvances } from "./fundAdvances.js";
import { runCollections } from "./runCollections.js";
import { reconcileUnresolved } from "./reconcileUnresolved.js";
import { pauseOnBlocked } from "./pauseOnBlocked.js";

export {
  ingestReceipts,
  createBudgets,
  fundAdvances,
  runCollections,
  reconcileUnresolved,
  pauseOnBlocked,
};
export type { IngestReceiptsResult } from "./ingestReceipts.js";
export type { CreateBudgetsResult } from "./createBudgets.js";
export type { FundAdvancesResult } from "./fundAdvances.js";
export type { RunCollectionsResult } from "./runCollections.js";
export type { ReconcileUnresolvedResult } from "./reconcileUnresolved.js";
export type { BroadcastOutcome } from "./broadcast.js";
export { broadcastAndReconcile, toContractIntent } from "./broadcast.js";
export { lastCompletedWindowIndex } from "./createBudgets.js";

export const JOB_NAMES = [
  "ingestReceipts",
  "createBudgets",
  "reconcileUnresolved",
  "fundAdvances",
  "runCollections",
  "pauseOnBlocked",
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

/**
 * One worker tick. Reconciliation runs BEFORE collections so an intent that
 * resolved between ticks unblocks the advance in the same tick; the health
 * (pause) evaluation runs LAST with fully current data.
 */
export async function runOnce(
  ctx: WorkerContext,
): Promise<Record<JobName, unknown>> {
  const results: Partial<Record<JobName, unknown>> = {};
  for (const job of JOB_NAMES) {
    results[job] = await runJob(ctx, job);
  }
  return results as Record<JobName, unknown>;
}

export async function runJob(
  ctx: WorkerContext,
  job: JobName,
): Promise<unknown> {
  switch (job) {
    case "ingestReceipts":
      return ingestReceipts(ctx);
    case "createBudgets":
      return createBudgets(ctx);
    case "reconcileUnresolved":
      return reconcileUnresolved(ctx);
    case "fundAdvances":
      return fundAdvances(ctx);
    case "runCollections":
      return runCollections(ctx);
    case "pauseOnBlocked":
      return pauseOnBlocked(ctx);
  }
}
