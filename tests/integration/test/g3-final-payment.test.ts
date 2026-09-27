import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  assertOutstandingMatchesLedger,
  ledgerEntriesForAdvance,
  listOpenAdvances,
  paymentIntents,
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
 * G3: remaining debt below the normal payment => exact final partial payment,
 * then STOP (no post-payoff collection ever again).
 *
 * principal/obligation 30; rate 10%; ceiling 20:
 *   budget[1] = min(10% of 250 = 25, 20, 30)  = 20  -> outstanding 10
 *   budget[2] = min(10% of 300 = 30, 20, 10)  = 10  -> outstanding 0 -> repaid
 */
suite("G3: exact final payment then stop at payoff", () => {
  beforeAll(async () => {
    testDb = await createTestDb("final_payment");
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  it("collects the exact remainder and marks the advance repaid", async () => {
    const { harness, advance, wallet } = await seedAdvanceHarness(testDb, {
      principalWhole: 30,
    });

    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);

    // Period 1: big sales, budget capped by the ceiling at 20.
    harness.adapter.setLedger([
      saleInWindow(0, 250, PAYER_1, wallet),
      dripInWindow(1, wallet),
    ]);
    harness.setTime(ANCHOR_SEC + PERIOD_SECONDS + 600);
    await ingestReceipts(harness.ctx);
    await createBudgets(harness.ctx);
    const first = await runCollections(harness.ctx);
    expect(first.confirmed).toBe(1);
    expect(
      (await listOpenAdvances(testDb.db)).find((a) => a.id === advance.id)!
        .confirmedOutstandingAmount,
    ).toBe(BigInt(wholeUnits(10)));

    // Period 2: outstanding (10) is BELOW the normal capped payment (20):
    // the budget freezes at 10 and the collection is the exact remainder.
    harness.adapter.addEvent(saleInWindow(1, 300, PAYER_1, wallet));
    harness.adapter.addEvent(dripInWindow(2, wallet));
    harness.setTime(ANCHOR_SEC + 2 * PERIOD_SECONDS + 600);
    await ingestReceipts(harness.ctx);
    await createBudgets(harness.ctx);
    const second = await runCollections(harness.ctx);
    expect(second.confirmed).toBe(1);

    const repaid = (await listOpenAdvances(testDb.db)).find(
      (a) => a.id === advance.id,
    );
    expect(repaid).toBeUndefined(); // repaid advances are no longer open

    const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
    const repayments = entries.filter((e) => e.kind === "repayment");
    expect(repayments).toHaveLength(2);
    expect(repayments[0]!.amount).toBe(-BigInt(wholeUnits(20)));
    expect(repayments[1]!.amount).toBe(-BigInt(wholeUnits(10))); // exact final partial
    await assertOutstandingMatchesLedger(
      testDb.db,
      advance.id,
      BigInt(wholeUnits(30)),
      0n,
    );

    // Stop at payoff: further ticks NEVER collect again (PLAN 6.9).
    harness.adapter.addEvent(saleInWindow(3, 999, PAYER_1, wallet));
    harness.setTime(ANCHOR_SEC + 4 * PERIOD_SECONDS + 600);
    await ingestReceipts(harness.ctx);
    await createBudgets(harness.ctx);
    const afterPayoff = await runCollections(harness.ctx);
    expect(afterPayoff.reserved).toBe(0);
    expect(afterPayoff.confirmed).toBe(0);
    const intents = await testDb.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.advanceId, advance.id));
    expect(intents.filter((i) => i.kind === "collection")).toHaveLength(2);
    const entriesFinal = await ledgerEntriesForAdvance(testDb.db, advance.id);
    expect(entriesFinal.filter((e) => e.kind === "repayment")).toHaveLength(2);
  });
});
