/**
 * Library surface of the Float worker (work package D). The executable CLI
 * lives in src/main.ts (`pnpm --filter @float/worker start`). Manual job
 * triggers are OPERATOR-ONLY: they are exposed exclusively through this CLI,
 * never through read-only API paths (PLAN section 6.10).
 */
export { loadWorkerConfig, type WorkerConfig } from "./config.js";
export { createWorkerContext, type WorkerContext } from "./context.js";
export {
  policyReceiptPipeline,
  type ReceiptPipeline,
  type PipelineClassifiedEvent,
  type PipelineSnapshot,
  type BuildSnapshotsRequest,
} from "./pipeline.js";
export {
  JOB_NAMES,
  isJobName,
  runJob,
  runOnce,
  type JobName,
} from "./jobs/index.js";
export {
  ingestReceipts,
  createBudgets,
  fundAdvances,
  runCollections,
  reconcileUnresolved,
  pauseOnBlocked,
  broadcastAndReconcile,
  lastCompletedWindowIndex,
} from "./jobs/index.js";
export { toContractIntent } from "./jobs/broadcast.js";
