import { createDb, resolveDatabaseUrl } from "@float/db";
import { createTempoAdapter } from "@float/chain";
import type { TempoAdapter } from "@float/contracts";
import {
  createWorkerContext,
  isJobName,
  loadWorkerConfig,
  runJob,
  runOnce,
  JOB_NAMES,
} from "./index.js";

/**
 * Operator-only worker CLI (PLAN section 6.10: read-only views cannot send
 * transactions; manual triggers are operator-only).
 *
 *   pnpm --filter @float/worker start               # persistent loop (default)
 *   pnpm --filter @float/worker start -- --once     # one full tick
 *   pnpm --filter @float/worker start -- --job=NAME # one named job once
 *   pnpm --filter @float/worker start -- --help
 *
 * Job names: ${JOB_NAMES.join(", ")}
 *
 * The live adapter comes from packages/chain (work package B); until G1
 * evidence lands there, startup fails with that adapter's explicit error
 * rather than silently doing nothing.
 */
function parseArgs(argv: string[]): {
  job: string | null;
  once: boolean;
  intervalMs: number | null;
  help: boolean;
} {
  let job: string | null = null;
  let once = false;
  let intervalMs: number | null = null;
  let help = false;
  for (const arg of argv) {
    if (arg === "--") continue; // pnpm passes the separator through verbatim
    if (arg === "--once") once = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg.startsWith("--job=")) job = arg.slice("--job=".length);
    else if (arg.startsWith("--interval-ms=")) {
      intervalMs = Number.parseInt(arg.slice("--interval-ms=".length), 10);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return { job, once, intervalMs, help };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      `float-worker — persistent ingestion/funding/collection/reconciliation worker\n` +
        `usage: pnpm --filter @float/worker start -- [--once | --job=<${JOB_NAMES.join("|")}>] [--interval-ms=N]\n` +
        `manual triggers are operator-only; read-only API paths never expose them`,
    );
    return;
  }

  const config = loadWorkerConfig();
  const { db, pool } = createDb(config.databaseUrl);
  let adapter: TempoAdapter;
  try {
    adapter = createTempoAdapter(config.chain);
  } catch (err) {
    console.error(
      "[float-worker] live Tempo adapter unavailable (work package B / G1):",
      err instanceof Error ? err.message : err,
    );
    await pool.end();
    process.exit(1);
  }

  const ctx = createWorkerContext({ db, adapter: adapter!, config });
  console.log(
    `[float-worker] database=${resolveDatabaseUrl().replace(/:\/\/.*@/, "://***@")} chainId=${config.chain.chainId} evidence=${ctx.evidenceMode}`,
  );

  try {
    if (args.job !== null) {
      if (!isJobName(args.job)) {
        throw new Error(
          `unknown job "${args.job}" (known: ${JOB_NAMES.join(", ")})`,
        );
      }
      const result = await runJob(ctx, args.job);
      console.log(`[float-worker] job ${args.job}:`, JSON.stringify(result));
      return;
    }
    if (args.once) {
      const results = await runOnce(ctx);
      console.log("[float-worker] tick:", JSON.stringify(results));
      return;
    }
    const intervalMs = args.intervalMs ?? config.pollIntervalMs;
    console.log(`[float-worker] looping every ${intervalMs}ms; ctrl-c to stop`);
    for (;;) {
      try {
        const results = await runOnce(ctx);
        console.log("[float-worker] tick:", JSON.stringify(results));
      } catch (err) {
        // One job's failure must not kill the loop; the next tick retries.
        console.error("[float-worker] tick failed:", err);
      }
      await sleep(intervalMs);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[float-worker] fatal", err);
  process.exit(1);
});
