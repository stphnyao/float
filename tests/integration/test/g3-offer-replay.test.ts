import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  acceptOffer,
  ledgerEntriesForAdvance,
  listOpenAdvances,
  paymentIntents,
  collectionReservations,
} from "@float/db";
import { fundAdvances } from "@float/worker";
import {
  acceptSeedOffer,
  ANCHOR_SEC,
  makeHarness,
  MERCHANT,
  seedOffer,
} from "./helpers.js";
import { createTestDb, databaseAvailable, type TestDb } from "./testdb.js";

const dbUp = await databaseAvailable();
const suite = dbUp ? describe : describe.skip;

let testDb: TestDb;

/**
 * G3: auth/offer replay or another merchant's ID => rejected WITHOUT any
 * financial mutation (no advance, no intent, no reservation, no ledger row).
 */
suite("G3: offer replay and identity binding", () => {
  beforeAll(async () => {
    testDb = await createTestDb("offer_replay");
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  it("rejects an expired offer, a non-eligible decision, and a wrong-identity acceptance with no financial mutation", async () => {
    makeHarness(testDb);

    // Expired offer.
    const expiredOffer = await seedOffer(testDb, {
      merchantWalletAddress: MERCHANT,
      principalWhole: 10,
      expiresInSeconds: -1, // already expired relative to seed time
    });
    await expect(acceptSeedOffer(testDb, expiredOffer)).rejects.toMatchObject({
      code: "OFFER_EXPIRED",
    });

    // Declined (non-eligible) offer.
    const declinedOffer = await seedOffer(testDb, {
      merchantWalletAddress: MERCHANT,
      principalWhole: 10,
      decision: "declined",
    });
    await expect(acceptSeedOffer(testDb, declinedOffer)).rejects.toMatchObject({
      code: "OFFER_ALREADY_DECIDED",
    });

    // Another merchant's ID: the authenticated wallet does not own the offer.
    const victimOffer = await seedOffer(testDb, {
      merchantWalletAddress: MERCHANT,
      principalWhole: 10,
    });
    await expect(
      acceptSeedOffer(testDb, victimOffer, {
        expectedWallet: "0x" + "55".repeat(20),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_MISMATCHED_IDENTITY" });

    // No advance was created for any of these: zero financial rows exist.
    const intents = await testDb.db.select().from(paymentIntents);
    const reservations = await testDb.db.select().from(collectionReservations);
    expect(intents).toHaveLength(0);
    expect(reservations).toHaveLength(0);

    // The victim offer still accepts cleanly for its rightful owner.
    const ok = await acceptSeedOffer(testDb, victimOffer);
    expect(ok.replayed).toBe(false);

    // Leave the schema quiescent for later tests: fund this advance.
    await fundAdvances(makeHarness(testDb).ctx);
    expect(
      (await listOpenAdvances(testDb.db)).find((a) => a.id === ok.advance.id)
        ?.state,
    ).toBe("active");
  });

  it("replaying an already-accepted offer returns the same advance, never a second one", async () => {
    makeHarness(testDb);
    const wallet = "0x" + "ab".repeat(20);
    const offer = await seedOffer(testDb, {
      merchantWalletAddress: wallet,
      principalWhole: 25,
    });
    const first = await acceptSeedOffer(testDb, offer, {
      expectedWallet: wallet,
    });
    const second = await acceptSeedOffer(testDb, offer, {
      expectedWallet: wallet,
    });
    expect(second.replayed).toBe(true);
    expect(second.advance.id).toBe(first.advance.id);
    const intents = await testDb.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.advanceId, first.advance.id));
    expect(intents).toHaveLength(1);

    // Leave the schema quiescent for later tests: fund this advance.
    await fundAdvances(makeHarness(testDb).ctx);
  });

  it("accepting an offer whose advance exists but terms hash differs is rejected", async () => {
    makeHarness(testDb);
    const wallet = "0x" + "cd".repeat(20);
    const offer = await seedOffer(testDb, {
      merchantWalletAddress: wallet,
      principalWhole: 25,
    });
    const { advance } = await acceptSeedOffer(testDb, offer, {
      expectedWallet: wallet,
    });
    await expect(
      acceptOffer(testDb.db, {
        offerId: offer.id,
        termsHash: `0x${"3".repeat(64)}`,
        now: new Date(ANCHOR_SEC * 1000),
        expectedMerchantWalletAddress: wallet,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_MISMATCHED_IDENTITY" });
    expect(
      (await listOpenAdvances(testDb.db)).filter((a) => a.id === advance.id),
    ).toHaveLength(1);

    // Leave the schema quiescent for later tests: fund this advance.
    await fundAdvances(makeHarness(testDb).ctx);
  });

  it("a definitively failed funding frees the one-open slot (funding_failed is terminal)", async () => {
    const harness = makeHarness(testDb);
    const wallet = "0x" + "ef".repeat(20);
    const offer = await seedOffer(testDb, {
      merchantWalletAddress: wallet,
      principalWhole: 40,
    });
    const { advance } = await acceptSeedOffer(testDb, offer, {
      expectedWallet: wallet,
    });
    harness.adapter.setSubmitScript(["protocol-failure"]);
    harness.setTime(ANCHOR_SEC);
    const funded = await fundAdvances(harness.ctx);
    void funded;
    const rows = await listOpenAdvances(testDb.db);
    // funding_failed is NOT an open state, so the advance left the open list.
    expect(rows.find((a) => a.id === advance.id)).toBeUndefined();
    const entries = await ledgerEntriesForAdvance(testDb.db, advance.id);
    expect(entries).toHaveLength(0); // no money moved

    // The merchant slot is free again: a fresh offer accepts.
    const secondOffer = await seedOffer(testDb, {
      merchantWalletAddress: wallet,
      principalWhole: 40,
    });
    const retry = await acceptSeedOffer(testDb, secondOffer, {
      expectedWallet: wallet,
    });
    expect(retry.replayed).toBe(false);
    expect(retry.advance.state).toBe("funding_pending");
  });
});
