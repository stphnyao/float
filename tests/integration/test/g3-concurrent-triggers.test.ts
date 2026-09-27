import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  collectionReservations,
  computeCollectionAllowance,
  ledgerEntriesForAdvance,
  listBudgets,
  paymentIntents,
  reserveForCollection,
  collectionIntentKey,
  assertOutstandingMatchesLedger,
} from "@float/db";
import {
  createBudgets,
  fundAdvances,
  ingestReceipts,
  runCollections,
} from "@float/worker";
import {
  ANCHOR_SEC,
  dripInWindow,
  PAYER_1,
  PERIOD_SECONDS,
  saleInWindow,
  seedAdvanceHarness,
  wholeUnits,
} from "./helpers.js";
import { createTestDb, databaseAvailable, type TestDb } from "./testdb.js";

const dbUp = await databaseAvailable();
const suite = dbUp ? describe : describe.skip;

let testDb: TestDb;

/**
 * G3: duplicate jobs / concurrent triggers => no duplicate collection or
 * reservation. Two full worker collections race each other; two raw
 * reserveForCollection calls race each other; two createBudgets race each
 * other. Exactly one intent / reservation / ledger effect survives each race.
 *
 * Simulated accelerated periods (3600 s, injected clock) — NOT evidence of a
 * 24-hour chain rollover (PLAN section 3).
 */
suite("G3: concurrent triggers => no duplicate reservation", () => {
  beforeAll(async () => {
    testDb = await createTestDb("concurrent");
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  /**
   * Funds an advance, seeds `salesWhole` of sales in receipts window 0 plus a
   * coverage-anchoring drip in window 1, advances the clock into period 1 and
   * freezes the budgets. The active collection budget for period 1 is
   * min(10% of sales, ceiling, outstanding).
   */
  async function setupFundedAdvanceWithBudget(
    principalWhole: number,
    salesWhole: number,
  ) {
    const { harness, advance, wallet } = await seedAdvanceHarness(testDb, {
      principalWhole,
    });
    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);

    harness.adapter.setLedger([
      saleInWindow(0, salesWhole, PAYER_1, wallet),
      dripInWindow(1, wallet), // anchors coverage past window 0's end
    ]);
    harness.setTime(ANCHOR_SEC + PERIOD_SECONDS + 600);
    await ingestReceipts(harness.ctx);
    await createBudgets(harness.ctx);
    return { harness, advance, wallet };
  }

  it("two concurrent runCollections triggers produce exactly one collection", async () => {
    const { harness, advance } = await setupFundedAdvanceWithBudget(100, 100);

    const [r1, r2] = await Promise.all([
      runCollections(harness.ctx),
      runCollections(harness.ctx),
    ]);
    const reservedCount = [r1, r2].filter((r) => r.reserved === 1).length;
    expect(reservedCount).toBe(1);

    const intents = await testDb.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.advanceId, advance.id));
    const collectionIntents = intents.filter((i) => i.kind === "collection");
    expect(collectionIntents).toHaveLength(1);

    const reservations = await testDb.db
      .select()
      .from(collectionReservations)
      .where(eq(collectionReservations.advanceId, advance.id));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.status).toBe("settled"); // reconciled, not duplicated

    const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
    const repayments = entries.filter((e) => e.kind === "repayment");
    expect(repayments).toHaveLength(1);
    expect(repayments[0]!.amount).toBe(-BigInt(wholeUnits(10))); // 10% of 100
    await assertOutstandingMatchesLedger(
      testDb.db,
      advance.id,
      BigInt(wholeUnits(100)),
      BigInt(wholeUnits(90)),
    );
  });

  it("two concurrent reserveForCollection calls with the same key: one reserved, one existing", async () => {
    const { harness, advance } = await setupFundedAdvanceWithBudget(100, 200);
    const budget = (await listBudgets(testDb.db, advance.id)).find(
      (b) => b.status === "active",
    );
    expect(budget).toBeDefined();
    // budget = min(10% of 200 = 20, ceiling 20, outstanding 100) = 20
    expect(budget!.budgetAmount).toBe(BigInt(wholeUnits(20)));
    const input = {
      advanceId: advance.id,
      budgetId: budget!.id,
      requestedAmount: BigInt(wholeUnits(20)),
      idempotencyKey: collectionIntentKey(advance.id, budget!.id),
      now: new Date(harness.clock.now * 1000),
    };
    const [a, b] = await Promise.all([
      reserveForCollection(testDb.db, input),
      reserveForCollection(testDb.db, input),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toContain("reserved");
    expect(kinds).toContain("existing");
    if (a.kind === "reserved" && b.kind === "existing") {
      expect(a.intent.id).toBe(b.intent.id);
    } else if (b.kind === "reserved" && a.kind === "existing") {
      expect(b.intent.id).toBe(a.intent.id);
    }
    const intents = await testDb.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.advanceId, advance.id));
    expect(intents.filter((i) => i.kind === "collection")).toHaveLength(1);
  });

  it("two concurrent createBudgets triggers create each period budget once", async () => {
    const { harness, advance, wallet } = await setupFundedAdvanceWithBudget(
      100,
      100,
    );
    // Window 1 receipts + a window-2 coverage drip so periods 1 AND 2 budget.
    harness.adapter.addEvent(saleInWindow(1, 50, PAYER_1, wallet));
    harness.adapter.addEvent(dripInWindow(2, wallet));
    harness.setTime(ANCHOR_SEC + 2 * PERIOD_SECONDS + 600);
    await ingestReceipts(harness.ctx);
    await Promise.all([createBudgets(harness.ctx), createBudgets(harness.ctx)]);
    const budgets = await listBudgets(testDb.db, advance.id);
    expect(budgets).toHaveLength(2); // periods 1 and 2, no duplicates
    const starts = budgets.map((b) => b.periodStart.getTime());
    expect(new Set(starts).size).toBe(2);
  });

  it("reserve caps by the outstanding remainder: over-collection is impossible", async () => {
    const { harness, advance } = await setupFundedAdvanceWithBudget(30, 300);
    const budget = (await listBudgets(testDb.db, advance.id)).find(
      (b) => b.status === "active",
    );
    // budget = min(10% of 300 = 30, ceiling 20, outstanding 30) = 20
    expect(budget!.budgetAmount).toBe(BigInt(wholeUnits(20)));
    const remainders = await computeCollectionAllowance(
      testDb.db,
      advance.id,
      new Date(harness.clock.now * 1000),
    );
    expect(remainders.cap).toBe(BigInt(wholeUnits(20)));
    // Requesting far more than owed must clamp to the cap, not over-reserve.
    const reserved = await reserveForCollection(testDb.db, {
      advanceId: advance.id,
      budgetId: budget!.id,
      requestedAmount: BigInt(wholeUnits(500)),
      idempotencyKey: collectionIntentKey(advance.id, budget!.id),
      now: new Date(harness.clock.now * 1000),
    });
    expect(reserved.kind).toBe("reserved");
    if (reserved.kind === "reserved") {
      expect(reserved.amount).toBe(BigInt(wholeUnits(20)));
    }
  });
});
