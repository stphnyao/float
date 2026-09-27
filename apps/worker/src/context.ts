import type { TempoAdapter } from "@float/contracts";
import type { Db } from "@float/db";
import type { WorkerConfig } from "./config.js";
import { policyReceiptPipeline, type ReceiptPipeline } from "./pipeline.js";

/**
 * Everything a job needs. The adapter and pipeline are injected so tests run
 * the SAME job code against FakeTempoAdapter + a stub classifier. When the
 * adapter is a fake, evidence is forced to `synthetic_fixture` — a fake can
 * never generate live-looking (observed_testnet) evidence (PLAN section 5).
 */
export interface WorkerContext {
  db: Db;
  adapter: TempoAdapter;
  pipeline: ReceiptPipeline;
  config: WorkerConfig;
  /** Effective evidence mode stamped on snapshots and surfaced to the UI. */
  evidenceMode: "synthetic_fixture" | "observed_testnet";
  /** Injectable clock (integer unix seconds). */
  nowSec(): number;
}

export function createWorkerContext(input: {
  db: Db;
  adapter: TempoAdapter;
  config: WorkerConfig;
  pipeline?: ReceiptPipeline;
  nowSec?: () => number;
}): WorkerContext {
  const evidenceMode =
    input.adapter.implementation === "fake"
      ? ("synthetic_fixture" as const)
      : ("observed_testnet" as const);
  const pipeline =
    input.pipeline ?? defaultPipeline(input.config, evidenceMode);
  return {
    db: input.db,
    adapter: input.adapter,
    pipeline,
    config: input.config,
    evidenceMode,
    nowSec: input.nowSec ?? (() => Math.floor(Date.now() / 1000)),
  };
}

function defaultPipeline(
  config: WorkerConfig,
  evidenceMode: "synthetic_fixture" | "observed_testnet",
): ReceiptPipeline {
  return policyReceiptPipeline({
    chainId: config.chain.chainId,
    merchantAddress: config.merchantAddress,
    treasuryAddress: config.treasuryAddress,
    tokenAddress: config.chain.tokenAddress,
    faucetSenders: config.faucetSenders,
    knownSelfFundingSources: config.knownSelfFundingSources,
    knownNonSaleSenders: config.knownNonSaleSenders,
    evidenceMode,
  });
}
