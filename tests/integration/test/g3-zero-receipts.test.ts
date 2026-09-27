import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  ledgerEntriesForAdvance,
  listBudgets,
  listOpenAdvances,
  paymentIntents,
} from "@float/db";
import {
  createBudgets,
  fundAdvances,
  ingestReceipts,
  pauseOnBlocked,
  runCollections,
} from "@float/worker";
import {
  ANCHOR_SEC,
  dripInWindow,
  PERIOD_SECONDS,
  seedAdvanceHarness,
} from "./helpers.js";
import { createTestDb, databaseAvailable, type TestDb } from "./testdb.js";

const dbUp = await databaseAvailable();
const suite = dbUp ? describe : describe.skip;

let testDb: TestDb;

/**
 * G3: zero eligible receipts => NO repayment transaction. With COMPLETE
 * scan coverage and zero eligible receipts the frozen budgets are zero
 * (status exhausted) and no intent is ever created. (Missing scan coverage
 * would instead pause — see the pause-reasons suite.)
 */
suite("G3: zero receipts => no repayment transaction", () => {
  beforeAll(async () => {
    testDb = await createTestDb("zero_receipts");
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  it("a fully-covered window with zero eligible receipts yields no intent and no tx", async () => {
    const { harness, advance, wallet } = await seedAdvanceHarness(testDb, {
      principalWhole: 100,
    });

    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);
    expect(
      (await listOpenAdvances(testDb.db)).find((a) => a.id === advance.id)
        ?.state,
    ).toBe("active");

    // Windows 0 and 1: ONLY faucet drips — events that anchor coverage but
    // are excluded from revenue by classification. The window-2 drip anchors
    // coverage past window 1's end so both windows freeze as COMPLETE with
    // zero eligible receipts.
    harness.adapter.setLedger([
      dripInWindow(0, wallet),
      dripInWindow(1, wallet),
      dripInWindow(2, wallet),
    ]);
    harness.setTime(ANCHOR_SEC + 2 * PERIOD_SECONDS + 60);
    await ingestReceipts(harness.ctx);
    await createBudgets(harness.ctx);

    const budgets = await listBudgets(testDb.db, advance.id);
    expect(budgets).toHaveLength(2); // budgets for periods 1 and 2 exist...
    for (const budget of budgets) {
      expect(budget.budgetAmount).toBe(0n); // ...but all are zero
      expect(budget.status).toBe("exhausted");
    }

    const collect = await runCollections(harness.ctx);
    expect(collect.reserved).toBe(0);
    expect(
      collect.skipped.some((s) => s.reason === "ZERO_ELIGIBLE_RECEIPTS"),
    ).toBe(true);

    const intents = await testDb.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.advanceId, advance.id));
    expect(intents.filter((i) => i.kind === "collection")).toHaveLength(0);

    const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
    expect(entries.filter((e) => e.kind === "repayment")).toHaveLength(0);

    // Health stays clean: no blockers (data complete, nothing collectable).
    const health = await pauseOnBlocked(harness.ctx);
    expect(health.paused).toHaveLength(0);
    const stillActive = (await listOpenAdvances(testDb.db)).find(
      (a) => a.id === advance.id,
    );
    expect(stillActive!.state).toBe("active");
  });
});
