import type { Db } from "@float/db";
import {
  computeCollectionAllowance,
  getActiveBudgetContaining,
  getAuthorizationForAdvance,
  listOpenAdvances,
  reserveForCollection,
  collectionIntentKey,
  collectionBudgets,
  type AdvanceRow,
  type CollectionBudgetRow,
} from "@float/db";
import { and, eq, gt, lte } from "drizzle-orm";
import type { WorkerContext } from "../context.js";
import { readAuthorizationChecked } from "./fundAdvances.js";
import { broadcastAndReconcile } from "./broadcast.js";

/**
 * Any budget (any status) whose period window contains `at` — used to
 * distinguish "zero eligible receipts this period" from "budget missing
 * because of a scan gap".
 */
async function getZeroBudgetContaining(
  db: Db,
  advanceId: string,
  at: Date,
): Promise<CollectionBudgetRow | null> {
  const rows = await db
    .select()
    .from(collectionBudgets)
    .where(
      and(
        eq(collectionBudgets.advanceId, advanceId),
        eq(collectionBudgets.budgetAmount, 0n),
        lte(collectionBudgets.periodStart, at),
        gt(collectionBudgets.periodEnd, at),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface RunCollectionsResult {
  job: "runCollections";
  reserved: number;
  confirmed: number;
  unresolved: number;
  failed: number;
  skipped: { advanceId: string; reason: string; detail?: string }[];
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a <= b ? a : b;
}

/**
 * Collection job. For each ACTIVE advance with an active budget covering
 * `now`:
 *  1. compute the two remainders (budget remainder, outstanding remainder);
 *  2. clamp the desired payment by the live on-chain remaining period
 *     allowance and the merchant's spendable balance (PLAN section 3);
 *  3. reserveForCollection — under the per-advance advisory lock — caps the
 *     payment by BOTH remainders again and persists intent + held
 *     reservation BEFORE any broadcast;
 *  4. broadcast through the shared flow and reconcile the known transaction.
 *
 * The idempotency key is stable per (advance, budget): duplicate or
 * concurrent job triggers resolve to the same intent, never a second
 * economic payment. An unresolved/submitted intent for the advance makes
 * reserveForCollection skip (UNRESOLVED_BLOCK) — reconcile first.
 */
export async function runCollections(
  ctx: WorkerContext,
): Promise<RunCollectionsResult> {
  const nowSec = ctx.nowSec();
  const nowDate = new Date(nowSec * 1000);
  const active = (await listOpenAdvances(ctx.db)).filter(
    (advance) => advance.state === "active",
  );

  const result: RunCollectionsResult = {
    job: "runCollections",
    reserved: 0,
    confirmed: 0,
    unresolved: 0,
    failed: 0,
    skipped: [],
  };

  for (const advance of active as AdvanceRow[]) {
    const budget = await getActiveBudgetContaining(ctx.db, advance.id, nowDate);
    if (!budget) {
      // A zero-amount budget is stored `exhausted`; that is the zero-eligible
      // receipts case, not a missing budget (a truly missing budget for a
      // started period means a scan gap — the health job pauses for that).
      const zeroBudget = await getZeroBudgetContaining(
        ctx.db,
        advance.id,
        nowDate,
      );
      if (zeroBudget) {
        result.skipped.push({
          advanceId: advance.id,
          reason: "ZERO_ELIGIBLE_RECEIPTS",
        });
      } else {
        result.skipped.push({
          advanceId: advance.id,
          reason: "NO_ACTIVE_BUDGET",
        });
      }
      continue;
    }
    if (budget.budgetAmount === 0n) {
      // Zero eligible receipts: no collection, no intent (G3 matrix).
      result.skipped.push({
        advanceId: advance.id,
        reason: "ZERO_ELIGIBLE_RECEIPTS",
      });
      continue;
    }
    if (advance.confirmedOutstandingAmount === 0n) {
      result.skipped.push({
        advanceId: advance.id,
        reason: "OUTSTANDING_CLEARED",
      });
      continue;
    }

    const remainders = await computeCollectionAllowance(
      ctx.db,
      advance.id,
      nowDate,
    );
    if (remainders.cap <= 0n) {
      result.skipped.push({
        advanceId: advance.id,
        reason: "CAP_EXHAUSTED",
        detail: `budgetRemainder=${remainders.budgetRemainder} outstandingRemainder=${remainders.outstandingRemainder}`,
      });
      continue;
    }

    // Live chain caps: remaining period allowance and spendable balance.
    let desired = remainders.cap;
    const authRow = await getAuthorizationForAdvance(ctx.db, advance.id);
    if (authRow) {
      const read = await readAuthorizationChecked(ctx, authRow);
      if (read.remainingPeriodAllowance !== null) {
        desired = minBigInt(desired, BigInt(read.remainingPeriodAllowance));
      }
    }
    const balance = BigInt(
      await ctx.adapter.getBalance(
        advance.merchantAddress,
        advance.tokenAddress,
      ),
    );
    desired = minBigInt(desired, balance);
    if (desired <= 0n) {
      result.skipped.push({
        advanceId: advance.id,
        reason: "NO_SPENDABLE_BUDGET",
      });
      continue;
    }

    const reserved = await reserveForCollection(ctx.db, {
      advanceId: advance.id,
      budgetId: budget.id,
      requestedAmount: desired,
      idempotencyKey: collectionIntentKey(advance.id, budget.id),
      now: nowDate,
    });
    if (reserved.kind === "skipped") {
      result.skipped.push({
        advanceId: advance.id,
        reason: reserved.reason,
        detail: reserved.detail,
      });
      continue;
    }
    if (reserved.kind === "existing") {
      result.skipped.push({
        advanceId: advance.id,
        reason: "INTENT_EXISTS",
        detail: reserved.intent.id,
      });
      continue;
    }

    result.reserved += 1;
    // Merchant pays the treasury from the merchant wallet (delegated key).
    const outcome = await broadcastAndReconcile(
      ctx,
      reserved.intent,
      { from: advance.merchantAddress, to: advance.treasuryAddress },
      { tokenAddress: advance.tokenAddress },
    );
    if (outcome.status === "confirmed") result.confirmed += 1;
    else if (outcome.status === "unresolved") result.unresolved += 1;
    else result.failed += 1;
  }

  return result;
}
