import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  acceptOffer,
  ledgerEntriesForAdvance,
  listOpenAdvances,
  paymentIntents,
  reconcileIntent,
  getIntent,
} from "@float/db";
import { fundAdvances } from "@float/worker";
import {
  acceptSeedOffer,
  ANCHOR_SEC,
  makeHarness,
  MERCHANT,
  seedOffer,
  wholeUnits,
} from "./helpers.js";
import { createTestDb, databaseAvailable, type TestDb } from "./testdb.js";

const dbUp = await databaseAvailable();
const suite = dbUp ? describe : describe.skip;

let testDb: TestDb;

suite(
  "G3: duplicate acceptance/funding => one advance + one disbursement",
  () => {
    beforeAll(async () => {
      testDb = await createTestDb("dup_accept_fund");
    });
    afterAll(async () => {
      await testDb.cleanup();
    });

    it("rejects duplicate acceptance with a different terms hash and replays the identical one", async () => {
      const harness = makeHarness(testDb);
      const offer = await seedOffer(testDb, { principalWhole: 100 });

      const first = await acceptSeedOffer(testDb, offer);
      expect(first.replayed).toBe(false);
      expect(first.advance.state).toBe("funding_pending");

      // Identical replay: same row, no second advance, no second intent.
      const replay = await acceptSeedOffer(testDb, offer);
      expect(replay.replayed).toBe(true);
      expect(replay.advance.id).toBe(first.advance.id);

      // Tampered replay (different terms hash): rejected, no mutation.
      await expect(
        acceptOffer(testDb.db, {
          offerId: offer.id,
          termsHash: `0x${"f".repeat(64)}`,
          now: new Date(ANCHOR_SEC * 1000),
          expectedMerchantWalletAddress: MERCHANT,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_MISMATCHED_IDENTITY" });

      const advances = await listOpenAdvances(testDb.db);
      expect(advances).toHaveLength(1);
      const intents = await testDb.db
        .select()
        .from(paymentIntents)
        .where(and(eq(paymentIntents.advanceId, first.advance.id)));
      expect(intents).toHaveLength(1); // exactly one funding intent

      // Leave the schema quiescent for later tests: fund this advance.
      await fundAdvances(makeHarness(testDb).ctx);
      expect(
        (await listOpenAdvances(testDb.db)).find(
          (a) => a.id === first.advance.id,
        )?.state,
      ).toBe("active");
    });

    it("one open advance per merchant: a second offer for the same merchant rejects", async () => {
      makeHarness(testDb);
      const wallet = "0x" + "c1".repeat(20);
      const offer1 = await seedOffer(testDb, {
        merchantWalletAddress: wallet,
        principalWhole: 10,
      });
      const offer2 = await seedOffer(testDb, {
        merchantWalletAddress: wallet,
        principalWhole: 20,
      });
      const first = await acceptSeedOffer(testDb, offer1, {
        expectedWallet: wallet,
      });
      await expect(
        acceptSeedOffer(testDb, offer2, { expectedWallet: wallet }),
      ).rejects.toMatchObject({ code: "ADVANCE_ALREADY_OPEN" });

      // Leave the schema quiescent: fund this advance too.
      await fundAdvances(makeHarness(testDb).ctx);
      expect(
        (await listOpenAdvances(testDb.db)).find(
          (a) => a.id === first.advance.id,
        )?.state,
      ).toBe("active");
    });

    it("duplicate funding jobs and duplicate reconciles produce exactly one disbursement", async () => {
      const harness = makeHarness(testDb);
      const wallet = "0x" + "c2".repeat(20);
      const offer = await seedOffer(testDb, {
        merchantWalletAddress: wallet,
        principalWhole: 50,
      });
      const { advance, fundingIntentId } = await acceptSeedOffer(
        testDb,
        offer,
        {
          expectedWallet: wallet,
        },
      );

      harness.setTime(ANCHOR_SEC);
      // Two funding job runs in a row (duplicate trigger).
      const run1 = await fundAdvances(harness.ctx);
      expect(run1.funded).toBe(1);
      const run2 = await fundAdvances(harness.ctx);
      expect(run2.funded).toBe(0);

      const refreshed = (await listOpenAdvances(testDb.db)).find(
        (a) => a.id === advance.id,
      );
      expect(refreshed?.state).toBe("active");

      // Reconcile the SAME transaction again (duplicate delivery of outcome).
      const intent = await getIntent(testDb.db, fundingIntentId);
      expect(intent?.txHash).toBeTruthy();
      const outcome = await harness.adapter.reconcilePayment(intent!.txHash!);
      const reapplied = await reconcileIntent(testDb.db, {
        intentId: fundingIntentId,
        outcome,
      });
      expect(reapplied.kind).toBe("already-applied");

      const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
      expect(entries).toHaveLength(1); // ONE economic disbursement
      expect(entries[0]!.kind).toBe("disbursement");
      expect(entries[0]!.amount).toBe(BigInt(wholeUnits(50)));
      expect(
        harness.adapter.broadcastCountFor(`funding:v1:${advance.id}`),
      ).toBe(1);
    });
  },
);
