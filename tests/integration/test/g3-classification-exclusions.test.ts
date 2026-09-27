import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  ledgerEntriesForAdvance,
  listBudgets,
  listOpenAdvances,
  paymentIntents,
  revenueSnapshots,
} from "@float/db";
import {
  createBudgets,
  fundAdvances,
  ingestReceipts,
  runCollections,
} from "@float/worker";
import { stubPipeline } from "../fakes/stubPipeline.js";
import {
  addr,
  ANCHOR_SEC,
  dripInWindow,
  PERIOD_SECONDS,
  refundInWindow,
  saleInWindow,
  seedAdvanceHarness,
  TOKEN,
  TREASURY,
  wholeUnits,
} from "./helpers.js";
import { createTestDb, databaseAvailable, type TestDb } from "./testdb.js";

const dbUp = await databaseAvailable();
const suite = dbUp ? describe : describe.skip;

let testDb: TestDb;

/**
 * G3: refund / self-transfer / Float-disbursement exclusion via the
 * classification integration point (stub classifier — the money paths
 * depend on the ReceiptPipeline seam, not on policy v1 directly), and
 * duplicate event ingestion => no doubled revenue or repayment.
 */
suite("G3: classification exclusions and duplicate ingestion", () => {
  beforeAll(async () => {
    testDb = await createTestDb("classify");
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  it("excludes self-transfers and float disbursements, and netts refunds from revenue", async () => {
    const wallet = addr(0xc301);
    const { harness, advance } = await seedAdvanceHarness(testDb, {
      merchantWalletAddress: wallet,
      principalWhole: 100,
      pipeline: stubPipeline({
        chainId: 42431,
        merchantAddress: wallet,
        treasuryAddress: TREASURY,
        tokenAddress: TOKEN,
      }),
    });
    expect(harness.ctx.pipeline.classificationVersion).toBe("stub-v1");
    const payer = "0x" + "51".repeat(20);

    // On-chain activity in window 0 (real directions on chain). The refund
    // leaves the merchant; the fake's refund pass normalizes it to a
    // negative-amount event from the payer.
    harness.adapter.setLedger([
      saleInWindow(0, 50, payer, wallet),
      { ...saleInWindow(0, 30, payer, wallet), from: wallet, to: wallet }, // self-transfer
      { ...saleInWindow(0, 70, payer, wallet), from: TREASURY, to: wallet }, // float disbursement
      refundInWindow(0, payer, 10, wallet), // refund of the eligible sale
      dripInWindow(1, wallet), // anchors coverage past window 0's end
    ]);
    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);
    harness.setTime(ANCHOR_SEC + PERIOD_SECONDS + 600);
    await ingestReceipts(harness.ctx);
    await createBudgets(harness.ctx);

    const advanceRow = (await listOpenAdvances(testDb.db)).find(
      (a) => a.id === advance.id,
    )!;
    const snapshots = await testDb.db
      .select()
      .from(revenueSnapshots)
      .where(eq(revenueSnapshots.merchantId, advanceRow.merchantId));
    expect(snapshots).toHaveLength(1);
    // Net = +50 (sale) - 10 (refund adjustment); exclusions contribute 0.
    expect(snapshots[0]!.netEligibleAmount).toBe(BigInt(wholeUnits(40)));

    const budgets = await listBudgets(testDb.db, advance.id);
    // Budget = 10% of 40 = 4 (floor), capped by ceiling 20 and outstanding 100.
    expect(budgets).toHaveLength(1);
    expect(budgets[0]!.budgetAmount).toBe(BigInt(wholeUnits(4)));

    const collect = await runCollections(harness.ctx);
    expect(collect.confirmed).toBe(1);
    const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
    expect(entries.filter((e) => e.kind === "repayment")).toHaveLength(1);
    expect(entries.find((e) => e.kind === "repayment")!.amount).toBe(
      -BigInt(wholeUnits(4)),
    );
  });

  it("duplicate event ingestion never doubles revenue or repayment", async () => {
    const wallet = addr(0xc401);
    const { harness, advance } = await seedAdvanceHarness(testDb, {
      merchantWalletAddress: wallet,
      principalWhole: 100,
      pipeline: stubPipeline({
        chainId: 42431,
        merchantAddress: wallet,
        treasuryAddress: TREASURY,
        tokenAddress: TOKEN,
      }),
    });
    const payer = "0x" + "52".repeat(20);
    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);

    harness.adapter.setLedger([
      saleInWindow(0, 80, payer, wallet),
      dripInWindow(1, wallet),
    ]);

    // Ingest the SAME chain range three times (replay / restart / retriggers).
    const first = await ingestReceipts(harness.ctx);
    expect(first.insertedEvents).toBe(2);
    const second = await ingestReceipts(harness.ctx);
    expect(second.insertedEvents).toBe(0);
    const third = await ingestReceipts(harness.ctx);
    expect(third.insertedEvents).toBe(0);

    harness.setTime(ANCHOR_SEC + PERIOD_SECONDS + 600);
    await createBudgets(harness.ctx);
    await createBudgets(harness.ctx); // duplicate job trigger

    const advanceRow = (await listOpenAdvances(testDb.db)).find(
      (a) => a.id === advance.id,
    )!;
    const snapshots = await testDb.db
      .select()
      .from(revenueSnapshots)
      .where(eq(revenueSnapshots.merchantId, advanceRow.merchantId));
    expect(snapshots).toHaveLength(1); // one frozen window
    expect(snapshots[0]!.netEligibleAmount).toBe(BigInt(wholeUnits(80)));

    const budgets = await listBudgets(testDb.db, advance.id);
    expect(budgets).toHaveLength(1);
    expect(budgets[0]!.budgetAmount).toBe(BigInt(wholeUnits(8))); // 10% of 80, once

    await runCollections(harness.ctx);
    const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
    expect(entries.filter((e) => e.kind === "repayment")).toHaveLength(1);
    const intents = await testDb.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.advanceId, advance.id));
    expect(intents.filter((i) => i.kind === "collection")).toHaveLength(1);
  });
});
