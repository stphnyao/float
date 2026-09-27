import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { applyBasisPoints } from "@float/contracts";
import type { Db } from "./client.js";
import {
  collectionBudgets,
  type collectionBudgets as budgetsTable,
} from "./schema.js";
import type { DbOrTx, Tx } from "./tx.js";

export type CollectionBudgetRow = typeof budgetsTable.$inferSelect;

export interface CreateBudgetInput {
  advanceId: string;
  /** Collection period window [periodStart, periodEnd), anchored to the advance's periodAnchor. */
  periodStartSec: number;
  periodEndSec: number;
  /** Eligible receipts of the PRECEDING completed window (may be negative after refunds). */
  eligibleReceiptsAmount: bigint;
  rateBps: number;
  ceilingAmount: bigint;
  /** Confirmed outstanding AT BUDGET CREATION (PLAN section 3). */
  outstandingAtCreation: bigint;
  snapshotId: string | null;
}

/**
 * Collection budget for one period (PLAN section 3, frozen formula):
 *
 *   budget[p] = min(
 *     floor(rate_bps * max(0, eligible_receipts[p-1]) / 10000),
 *     agreed_period_ceiling,
 *     outstanding_at_budget_creation
 *   )
 *
 * Integer base units and integer bps only. Idempotent per
 * (advance, periodStart) via `collection_budgets_advance_period_once`: the
 * first creation wins, later triggers return the existing budget. A zero
 * budget is still created (frozen record) but marked exhausted — zero
 * eligible receipts produce NO repayment intent.
 */
export async function createBudgetForPeriod(
  db: DbOrTx,
  input: CreateBudgetInput,
): Promise<{ budget: CollectionBudgetRow; created: boolean }> {
  const nonNegativeReceipts =
    input.eligibleReceiptsAmount > 0n ? input.eligibleReceiptsAmount : 0n;
  const rateAmount = applyBasisPoints(nonNegativeReceipts, input.rateBps);
  const budgetAmount =
    rateAmount <= input.ceilingAmount
      ? rateAmount <= input.outstandingAtCreation
        ? rateAmount
        : input.outstandingAtCreation
      : input.ceilingAmount <= input.outstandingAtCreation
        ? input.ceilingAmount
        : input.outstandingAtCreation;
  const inserted = await db
    .insert(collectionBudgets)
    .values({
      advanceId: input.advanceId,
      periodStart: new Date(input.periodStartSec * 1000),
      periodEnd: new Date(input.periodEndSec * 1000),
      eligibleReceiptsAmount: input.eligibleReceiptsAmount,
      rateBps: input.rateBps,
      ceilingAmount: input.ceilingAmount,
      budgetAmount,
      remainingAmount: budgetAmount,
      snapshotId: input.snapshotId,
      status: budgetAmount > 0n ? "active" : "exhausted",
    })
    .onConflictDoNothing({
      target: [collectionBudgets.advanceId, collectionBudgets.periodStart],
    })
    .returning();
  if (inserted[0]) return { budget: inserted[0], created: true };
  const existing = await getBudgetForPeriodStart(
    db,
    input.advanceId,
    input.periodStartSec,
  );
  if (!existing) throw new Error("budget insert failed without conflict row");
  return { budget: existing, created: false };
}

/**
 * Unused expired budgets do not accumulate as catch-up charges (PLAN
 * section 3): when a period ends, an `active` budget is superseded. Its
 * remainder dies; outstanding debt remains subject to FUTURE periods' own
 * budgets. Held reservations are independent of budget status and survive
 * superseding until reconciled.
 */
export async function supersedeExpiredBudgets(
  db: DbOrTx,
  advanceId: string,
  at: Date,
): Promise<number> {
  const rows = await db
    .update(collectionBudgets)
    .set({ status: "superseded" })
    .where(
      and(
        eq(collectionBudgets.advanceId, advanceId),
        eq(collectionBudgets.status, "active"),
        lte(collectionBudgets.periodEnd, at),
      ),
    )
    .returning({ id: collectionBudgets.id });
  return rows.length;
}

export async function getBudgetForPeriodStart(
  db: DbOrTx,
  advanceId: string,
  periodStartSec: number,
): Promise<CollectionBudgetRow | null> {
  const rows = await db
    .select()
    .from(collectionBudgets)
    .where(
      and(
        eq(collectionBudgets.advanceId, advanceId),
        eq(collectionBudgets.periodStart, new Date(periodStartSec * 1000)),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The active budget whose period window contains `at`. */
export async function getActiveBudgetContaining(
  db: DbOrTx,
  advanceId: string,
  at: Date,
): Promise<CollectionBudgetRow | null> {
  const rows = await db
    .select()
    .from(collectionBudgets)
    .where(
      and(
        eq(collectionBudgets.advanceId, advanceId),
        eq(collectionBudgets.status, "active"),
        lte(collectionBudgets.periodStart, at),
        gt(collectionBudgets.periodEnd, at),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listBudgets(
  db: DbOrTx,
  advanceId: string,
): Promise<CollectionBudgetRow[]> {
  return db
    .select()
    .from(collectionBudgets)
    .where(eq(collectionBudgets.advanceId, advanceId))
    .orderBy(asc(collectionBudgets.periodStart));
}

/**
 * Reduces the budget remainder by a confirmed collection (called from
 * reconcileIntent inside the advisory-locked transaction). Never below zero.
 */
export async function debitBudgetRemaining(
  tx: Tx,
  budgetId: string,
  amount: bigint,
): Promise<void> {
  await tx
    .update(collectionBudgets)
    .set({
      remainingAmount: sql`greatest(${collectionBudgets.remainingAmount} - ${amount}, 0)`,
    })
    .where(eq(collectionBudgets.id, budgetId));
}
