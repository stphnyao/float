import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  collectionReservations,
  getIntent,
  ledgerEntriesForAdvance,
  listOpenAdvances,
  listBudgets,
  markIntentBroadcast,
  paymentIntents,
  reconcileIntent,
  reserveForCollection,
  collectionIntentKey,
} from "@float/db";
import {
  createBudgets,
  fundAdvances,
  ingestReceipts,
  reconcileUnresolved,
  runCollections,
  toContractIntent,
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
 * G3: crash around broadcast / lost RPC response => reconcile the KNOWN
 * transaction; no blind replacement payment. Simulated by driving the same
 * primitives the worker drives and "dying" between broadcast-ack and
 * reconcile: the intent is submitted with its txHash persisted, then a fresh
 * reconcileUnresolved run recovers it exactly once.
 */
suite(
  "G3: crash after broadcast before db ack => reconcile once, no second payment",
  () => {
    beforeAll(async () => {
      testDb = await createTestDb("crash_ack");
    });
    afterAll(async () => {
      await testDb.cleanup();
    });

    async function setupFundedAdvanceWithBudget() {
      const { harness, advance, wallet } = await seedAdvanceHarness(testDb, {
        principalWhole: 100,
      });
      harness.setTime(ANCHOR_SEC);
      await fundAdvances(harness.ctx);
      harness.adapter.setLedger([
        saleInWindow(0, 100, PAYER_1, wallet),
        dripInWindow(1, wallet),
      ]);
      harness.setTime(ANCHOR_SEC + PERIOD_SECONDS + 600);
      await ingestReceipts(harness.ctx);
      await createBudgets(harness.ctx);
      return { harness, advance };
    }

    async function reserveTen(
      harness: Awaited<
        ReturnType<typeof setupFundedAdvanceWithBudget>
      >["harness"],
      advanceId: string,
    ) {
      const budget = (await listBudgets(testDb.db, advanceId)).find(
        (b) => b.status === "active",
      );
      expect(budget).toBeDefined();
      const reserved = await reserveForCollection(testDb.db, {
        advanceId,
        budgetId: budget!.id,
        requestedAmount: BigInt(wholeUnits(10)),
        idempotencyKey: collectionIntentKey(advanceId, budget!.id),
        now: new Date(harness.clock.now * 1000),
      });
      if (reserved.kind !== "reserved") {
        throw new Error(
          `expected reservation, got ${JSON.stringify(reserved)}`,
        );
      }
      return reserved;
    }

    it("crash after txHash persistence: new run reconciles the SAME transaction exactly once", async () => {
      const { harness, advance } = await setupFundedAdvanceWithBudget();
      const reserved = await reserveTen(harness, advance.id);

      // --- the worker crashes right after the broadcast was acknowledged ---
      const { txHash } = await harness.adapter.submitPayment({
        intent: toContractIntent(reserved.intent),
        from: advance.merchantAddress,
        to: advance.treasuryAddress,
        tokenAddress: advance.tokenAddress,
      });
      // (the real flow: markIntentBroadcast -> reconcileIntent; the crash
      // loses everything after markIntentBroadcast)
      await markIntentBroadcast(testDb.db, {
        intentId: reserved.intent.id,
        txHash,
      });

      // New process: reconcileUnresolved finds the submitted intent with its
      // persisted txHash and reconciles the SAME transaction.
      const result = await reconcileUnresolved(harness.ctx);
      expect(result.reconciled).toBe(1);
      expect(result.applied).toBe(1);

      const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
      expect(entries.filter((e) => e.kind === "repayment")).toHaveLength(1);

      // Re-running recovery must be a no-op (no second payment, no drift).
      const again = await reconcileUnresolved(harness.ctx);
      expect(again.reconciled).toBe(0);
      const entriesAfter = await ledgerEntriesForAdvance(testDb.db, advance.id);
      expect(entriesAfter.filter((e) => e.kind === "repayment")).toHaveLength(
        1,
      );

      const refreshed = (await listOpenAdvances(testDb.db)).find(
        (a) => a.id === advance.id,
      );
      expect(refreshed!.confirmedOutstandingAmount).toBe(
        BigInt(wholeUnits(90)),
      );
    });

    it("lost response (UnresolvedSubmitError with txHash): reservation kept, later reconcile once", async () => {
      const { harness, advance } = await setupFundedAdvanceWithBudget();
      harness.adapter.setSubmitScript(["timeout-after-broadcast"]);
      const result = await runCollections(harness.ctx);
      expect(result.unresolved).toBe(1);

      const intents = await testDb.db
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.advanceId, advance.id));
      const collection = intents.find((i) => i.kind === "collection");
      expect(collection!.state).toBe("unresolved");
      expect(collection!.txHash).toBeTruthy();

      // Reservation still held while unresolved.
      const reservation = await testDb.db
        .select()
        .from(collectionReservations)
        .where(eq(collectionReservations.intentId, collection!.id));
      expect(reservation[0]!.status).toBe("held");

      // The chain actually confirmed; reconcile picks that up. No new
      // broadcast ever happens (never a replacement payment).
      const broadcastsBefore = harness.adapter.submittedBroadcasts.length;
      harness.adapter.setReconcileOutcome(collection!.txHash!, {
        status: "confirmed",
        txHash: collection!.txHash!,
        blockNumber: 99,
        confirmedAtSec: harness.clock.now,
      });
      const recovered = await reconcileUnresolved(harness.ctx);
      expect(recovered.applied).toBe(1);
      expect(harness.adapter.submittedBroadcasts.length).toBe(broadcastsBefore);

      const refreshedIntent = await getIntent(testDb.db, collection!.id);
      expect(refreshedIntent!.state).toBe("confirmed");
      const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
      expect(entries.filter((e) => e.kind === "repayment")).toHaveLength(1);
    });

    it("duplicate reconcile with the same outcome applies the ledger effect once", async () => {
      const { harness, advance } = await setupFundedAdvanceWithBudget();
      const reserved = await reserveTen(harness, advance.id);
      const { txHash } = await harness.adapter.submitPayment({
        intent: toContractIntent(reserved.intent),
        from: advance.merchantAddress,
        to: advance.treasuryAddress,
        tokenAddress: advance.tokenAddress,
      });
      await markIntentBroadcast(testDb.db, {
        intentId: reserved.intent.id,
        txHash,
      });
      const outcome = await harness.adapter.reconcilePayment(txHash);
      const first = await reconcileIntent(testDb.db, {
        intentId: reserved.intent.id,
        outcome,
      });
      expect(first.kind).toBe("applied");
      const second = await reconcileIntent(testDb.db, {
        intentId: reserved.intent.id,
        outcome,
      });
      expect(second.kind).toBe("already-applied");
      const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
      expect(entries.filter((e) => e.kind === "repayment")).toHaveLength(1);
    });
  },
);
