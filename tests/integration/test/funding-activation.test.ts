import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  getIntentByIdempotencyKey,
  fundingIntentKey,
  ledgerEntriesForAdvance,
  listOpenAdvances,
  markIntentBroadcast,
} from "@float/db";
import {
  fundAdvances,
  reconcileUnresolved,
  runOnce,
  toContractIntent,
} from "@float/worker";
import {
  acceptSeedOffer,
  ANCHOR_SEC,
  makeHarness,
  seedOffer,
} from "./helpers.js";
import { createTestDb, databaseAvailable, type TestDb } from "./testdb.js";

const dbUp = await databaseAvailable();
const suite = dbUp ? describe : describe.skip;

let testDb: TestDb;

/**
 * Funding activation invariants (PLAN section 6.7): ONLY a reconciled
 * confirmed funding intent moves funding_pending -> active. Submitted and
 * unresolved broadcasts never activate; a definitive funding failure is
 * terminal (funding_failed). The period anchor moves to the funding
 * confirmation time when activation happens.
 */
suite("funding: activation only on reconciled confirmation", () => {
  beforeAll(async () => {
    testDb = await createTestDb("funding_activation");
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  async function newPendingAdvance(walletSeed: string) {
    const harness = makeHarness(testDb);
    const wallet = "0x" + walletSeed.repeat(20);
    const offer = await seedOffer(testDb, {
      merchantWalletAddress: wallet,
      principalWhole: 10,
    });
    const { advance, fundingIntentId } = await acceptSeedOffer(testDb, offer, {
      expectedWallet: wallet,
    });
    return { harness, advance, fundingIntentId };
  }

  it("a submitted-but-unreconciled funding broadcast does NOT activate the advance", async () => {
    const { harness, advance, fundingIntentId } = await newPendingAdvance("f1");
    const intent = await getIntentByIdempotencyKey(
      testDb.db,
      fundingIntentKey(advance.id),
    );
    expect(intent!.state).toBe("prepared");

    // Broadcast, persist the hash, and "crash" before reconciling.
    const { txHash } = await harness.adapter.submitPayment({
      intent: toContractIntent(intent!),
      from: advance.treasuryAddress,
      to: advance.merchantAddress,
      tokenAddress: advance.tokenAddress,
    });
    await markIntentBroadcast(testDb.db, { intentId: fundingIntentId, txHash });

    let rows = await listOpenAdvances(testDb.db);
    expect(rows.find((a) => a.id === advance.id)!.state).toBe(
      "funding_pending",
    );
    expect(await ledgerEntriesForAdvance(testDb.db, advance.id)).toHaveLength(
      0,
    );

    // Recovery reconciles the SAME transaction; activation happens there.
    await reconcileUnresolved(harness.ctx);
    rows = await listOpenAdvances(testDb.db);
    const active = rows.find((a) => a.id === advance.id)!;
    expect(active.state).toBe("active");
    // Period anchor = funding confirmation time.
    expect(Math.floor(active.periodAnchor.getTime() / 1000)).toBe(
      harness.clock.now,
    );
  });

  it("an unresolved funding broadcast (lost response) keeps the advance pending, then activates on reconcile", async () => {
    const { harness, advance } = await newPendingAdvance("f2");
    harness.adapter.setSubmitScript(["timeout-after-broadcast"]);
    harness.setTime(ANCHOR_SEC);
    const run = await fundAdvances(harness.ctx);
    expect(run.funded).toBe(0);
    expect(
      (await listOpenAdvances(testDb.db)).find((a) => a.id === advance.id)!
        .state,
    ).toBe("funding_pending");

    // The chain actually confirmed: reconcile activates.
    const intent = await getIntentByIdempotencyKey(
      testDb.db,
      fundingIntentKey(advance.id),
    );
    expect(intent!.state).toBe("unresolved");
    harness.adapter.setReconcileOutcome(intent!.txHash!, {
      status: "confirmed",
      txHash: intent!.txHash!,
      blockNumber: 7,
      confirmedAtSec: harness.clock.now,
    });
    await reconcileUnresolved(harness.ctx);
    expect(
      (await listOpenAdvances(testDb.db)).find((a) => a.id === advance.id)!
        .state,
    ).toBe("active");
  });

  it("a definitive funding failure is terminal (funding_failed), with no ledger row", async () => {
    const { harness, advance } = await newPendingAdvance("f3");
    harness.adapter.setSubmitScript(["protocol-failure"]);
    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);
    const rows = await listOpenAdvances(testDb.db);
    expect(rows.find((a) => a.id === advance.id)).toBeUndefined(); // not open
    expect(await ledgerEntriesForAdvance(testDb.db, advance.id)).toHaveLength(
      0,
    );
    const intent = await getIntentByIdempotencyKey(
      testDb.db,
      fundingIntentKey(advance.id),
    );
    expect(intent!.state).toBe("failed");
  });

  it("a full worker tick runs the whole lifecycle in order", async () => {
    const { harness, advance } = await newPendingAdvance("f4");
    harness.setTime(ANCHOR_SEC);
    const tick = await runOnce(harness.ctx);
    expect((tick.fundAdvances as { funded: number }).funded).toBe(1);
    expect(
      (await listOpenAdvances(testDb.db)).find((a) => a.id === advance.id)!
        .state,
    ).toBe("active");
  });
});
