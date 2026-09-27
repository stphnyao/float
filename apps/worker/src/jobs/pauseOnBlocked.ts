import {
  computeCollectionAllowance,
  getBudgetForPeriodStart,
  getAuthorizationForAdvance,
  listOpenAdvances,
  hasBlockingIntent,
  setAdvanceState,
  type AdvanceRow,
} from "@float/db";
import type { WorkerContext } from "../context.js";
import { readAuthorizationChecked } from "./fundAdvances.js";
import { lastCompletedWindowIndex } from "./createBudgets.js";

/**
 * Accurate pause reasons (PLAN 6.8). Priority order (first match becomes the
 * stored reason code):
 *   1. COLLECTION_UNRESOLVED_PAYMENT            — an unknown-outcome tx exists
 *   2. COLLECTION_AUTHORIZATION_REVOKED         — db or chain says revoked
 *   3. COLLECTION_AUTHORIZATION_EXPIRED         — expiry passed (db or chain)
 *   4. COLLECTION_AUTHORIZATION_NOT_VALID       — missing/pending/invalid
 *   5. COLLECTION_SCAN_INCOMPLETE               — a completed receipt window
 *      has no budget (its snapshot was missing/incomplete)
 *   6. COLLECTION_WALLET_INSUFFICIENT_BALANCE   — spendable balance below the
 *      capped payment the advance could make right now
 *
 * These are safety states, never proof of default or fraud. When no blocker
 * remains (data caught up, key re-validated, balance refilled) a paused
 * advance RESUMES to active; active advances are left alone.
 */
export async function pauseOnBlocked(ctx: WorkerContext): Promise<{
  job: "pauseOnBlocked";
  paused: { advanceId: string; reason: string }[];
  resumed: string[];
}> {
  const nowSec = ctx.nowSec();
  const nowDate = new Date(nowSec * 1000);
  const open = await listOpenAdvances(ctx.db);
  const paused: { advanceId: string; reason: string }[] = [];
  const resumed: string[] = [];

  for (const advance of open as AdvanceRow[]) {
    if (advance.state === "funding_pending") continue; // waits on funding job
    const reason = await firstBlocker(ctx, advance, nowSec, nowDate);
    if (reason) {
      if (
        advance.state !== "paused" ||
        (advance.pauseReasonCode ?? "") !== reason
      ) {
        await ctx.db.transaction(async (tx) => {
          await setAdvanceState(tx, advance.id, "paused", {
            pauseReasonCode: reason,
            at: nowDate,
          });
        });
      }
      paused.push({ advanceId: advance.id, reason });
    } else if (advance.state === "paused") {
      await ctx.db.transaction(async (tx) => {
        await setAdvanceState(tx, advance.id, "active", { at: nowDate });
      });
      resumed.push(advance.id);
    }
  }

  return { job: "pauseOnBlocked", paused, resumed };
}

async function firstBlocker(
  ctx: WorkerContext,
  advance: AdvanceRow,
  nowSec: number,
  nowDate: Date,
): Promise<string | null> {
  // 1. unresolved payment blocks everything else until reconciled
  if (await hasBlockingIntent(ctx.db, advance.id, ["unresolved"])) {
    return "COLLECTION_UNRESOLVED_PAYMENT";
  }

  // 2-4. authorization state: db evidence first, then the live chain read.
  const authRow = await getAuthorizationForAdvance(ctx.db, advance.id);
  if (!authRow || authRow.state === "pending" || authRow.state === "invalid") {
    return "COLLECTION_AUTHORIZATION_NOT_VALID";
  }
  if (authRow.state === "revoked") return "COLLECTION_AUTHORIZATION_REVOKED";
  if (authRow.state === "expired") return "COLLECTION_AUTHORIZATION_EXPIRED";
  if (authRow.expiresAt && authRow.expiresAt.getTime() <= nowSec * 1000) {
    return "COLLECTION_AUTHORIZATION_EXPIRED";
  }
  const read = await readAuthorizationChecked(ctx, authRow);
  if (read.state === "revoked") return "COLLECTION_AUTHORIZATION_REVOKED";
  if (read.state === "expired") return "COLLECTION_AUTHORIZATION_EXPIRED";
  if (
    read.expirySec !== null &&
    read.expirySec <= nowSec &&
    read.state === "valid"
  ) {
    return "COLLECTION_AUTHORIZATION_EXPIRED";
  }
  if (read.state !== "valid") return "COLLECTION_AUTHORIZATION_NOT_VALID";

  // 5. scan completeness: every receipts window whose collection period has
  // started must have produced its budget (createBudgets only budgets
  // complete snapshots). Budget period p needs receipts window p-1 complete,
  // i.e. p <= floorDiv(now-anchor, P).
  const anchorSec = Math.floor(advance.periodAnchor.getTime() / 1000);
  const kLastBudgetPeriod =
    lastCompletedWindowIndex(anchorSec, advance.periodSeconds, nowSec) + 1;
  for (let p = 1; p <= kLastBudgetPeriod; p += 1) {
    const budget = await getBudgetForPeriodStart(
      ctx.db,
      advance.id,
      anchorSec + p * advance.periodSeconds,
    );
    if (!budget) return "COLLECTION_SCAN_INCOMPLETE";
  }

  // 6. spendable balance vs the capped payment the advance could make now.
  const remainders = await computeCollectionAllowance(
    ctx.db,
    advance.id,
    nowDate,
  );
  if (remainders.cap > 0n) {
    const balance = BigInt(
      await ctx.adapter.getBalance(
        advance.merchantAddress,
        advance.tokenAddress,
      ),
    );
    if (balance < remainders.cap)
      return "COLLECTION_WALLET_INSUFFICIENT_BALANCE";
  }

  return null;
}
