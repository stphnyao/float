import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  collectionReservations,
  listBudgets,
  listOpenAdvances,
  ledgerEntriesForAdvance,
  paymentIntents,
} from "@float/db";
import {
  createBudgets,
  fundAdvances,
  ingestReceipts,
  pauseOnBlocked,
  reconcileUnresolved,
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
 * G3: unresolved transaction across a period rollover => the reservation is
 * RETAINED, new collection stays blocked (in the same lock scope as the
 * reservation), and the known transaction is reconciled BEFORE any new
 * collection for the new period's budget. Simulated accelerated periods
 * (3600 s, injected clock) — NOT evidence of a 24-hour chain rollover
 * (PLAN section 3).
 */
suite("G3: unresolved transaction across period rollover", () => {
  beforeAll(async () => {
    testDb = await createTestDb("rollover");
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  it("keeps the reservation across the rollover and blocks new collection until reconciled", async () => {
    const { harness, advance, wallet } = await seedAdvanceHarness(testDb, {
      principalWhole: 100,
    });

    // Fund at the anchor; sales in window 0 => budget for period 1.
    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);
    harness.adapter.setLedger([
      saleInWindow(0, 100, PAYER_1, wallet),
      dripInWindow(1, wallet),
    ]);
    harness.setTime(ANCHOR_SEC + PERIOD_SECONDS + 600);
    await ingestReceipts(harness.ctx);
    await createBudgets(harness.ctx);

    // Period-1 collection attempt is lost in flight (timeout AFTER broadcast).
    harness.adapter.setSubmitScript(["timeout-after-broadcast"]);
    const collect = await runCollections(harness.ctx);
    expect(collect.unresolved).toBe(1);

    const intents = await testDb.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.advanceId, advance.id));
    const unresolvedIntent = intents.find((i) => i.kind === "collection");
    expect(unresolvedIntent!.state).toBe("unresolved");
    const reservation = await testDb.db
      .select()
      .from(collectionReservations)
      .where(eq(collectionReservations.intentId, unresolvedIntent!.id));
    expect(reservation[0]!.status).toBe("held");

    // ---- rollover into period 2 (window 1 receipts => budget for period 2) --
    // Window 1 already has a drip; the sale below is its receipt, and the
    // window-2 drip anchors coverage past window 1's end.
    harness.adapter.addEvent(saleInWindow(1, 100, PAYER_1, wallet));
    harness.adapter.addEvent(dripInWindow(2, wallet));
    harness.setTime(ANCHOR_SEC + 2 * PERIOD_SECONDS + 600);
    await ingestReceipts(harness.ctx);
    await createBudgets(harness.ctx);
    const budgets = await listBudgets(testDb.db, advance.id);
    expect(budgets).toHaveLength(2); // period 1 and period 2 budgets exist

    // New collection for period 2 MUST be blocked by the unresolved tx.
    const blocked = await runCollections(harness.ctx);
    expect(blocked.reserved).toBe(0);
    expect(blocked.skipped.some((s) => s.reason === "UNRESOLVED_BLOCK")).toBe(
      true,
    );

    // The health job pauses the advance with the accurate reason.
    const health = await pauseOnBlocked(harness.ctx);
    expect(
      health.paused.some((p) => p.reason === "COLLECTION_UNRESOLVED_PAYMENT"),
    ).toBe(true);
    const paused = (await listOpenAdvances(testDb.db)).find(
      (a) => a.id === advance.id,
    );
    expect(paused!.state).toBe("paused");
    expect(paused!.pauseReasonCode).toBe("COLLECTION_UNRESOLVED_PAYMENT");
    // Reservation survived the rollover; outstanding untouched (unreconciled
    // events never move money state).
    expect(paused!.confirmedOutstandingAmount).toBe(BigInt(wholeUnits(100)));

    // ---- reconcile the SAME transaction; no new broadcast ----
    const broadcastsBefore = harness.adapter.submittedBroadcasts.length;
    harness.adapter.setReconcileOutcome(unresolvedIntent!.txHash!, {
      status: "confirmed",
      txHash: unresolvedIntent!.txHash!,
      blockNumber: 500,
      confirmedAtSec: harness.clock.now,
    });
    const recovered = await reconcileUnresolved(harness.ctx);
    expect(recovered.applied).toBe(1);
    expect(harness.adapter.submittedBroadcasts.length).toBe(broadcastsBefore);

    const settled = await testDb.db
      .select()
      .from(collectionReservations)
      .where(eq(collectionReservations.intentId, unresolvedIntent!.id));
    expect(settled[0]!.status).toBe("settled");

    // Reconcile resumes the advance (blocker gone) and period 2 collects.
    await pauseOnBlocked(harness.ctx);
    const resumed = (await listOpenAdvances(testDb.db)).find(
      (a) => a.id === advance.id,
    );
    expect(resumed!.state).toBe("active");

    const next = await runCollections(harness.ctx);
    expect(next.reserved).toBe(1);
    expect(next.confirmed).toBe(1);

    const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
    const repayments = entries.filter((e) => e.kind === "repayment");
    expect(repayments).toHaveLength(2); // period-1 (recovered) + period-2
    const totalRepaid = repayments.reduce((sum, e) => sum + e.amount, 0n);
    // Two confirmed 10-unit collections against a 100-unit obligation.
    expect(totalRepaid).toBe(-BigInt(wholeUnits(20)));
    const final = (await listOpenAdvances(testDb.db)).find(
      (a) => a.id === advance.id,
    );
    expect(final!.confirmedOutstandingAmount).toBe(BigInt(wholeUnits(80)));
  });
});
