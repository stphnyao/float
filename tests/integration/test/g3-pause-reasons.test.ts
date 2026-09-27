import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listOpenAdvances } from "@float/db";
import {
  createBudgets,
  fundAdvances,
  ingestReceipts,
  pauseOnBlocked,
} from "@float/worker";
import {
  ANCHOR_SEC,
  dripInWindow,
  PAYER_1,
  PERIOD_SECONDS,
  saleInWindow,
  seedAdvanceHarness,
  TOKEN,
  wholeUnits,
} from "./helpers.js";
import { createTestDb, databaseAvailable, type TestDb } from "./testdb.js";

const dbUp = await databaseAvailable();
const suite = dbUp ? describe : describe.skip;

let testDb: TestDb;

/**
 * G3: insufficient balance / revoked / expired key / incomplete data =>
 * advance paused WITH THE ACCURATE REASON, and resumed when the blocker
 * clears. Pausing is a safety state, never proof of default or fraud
 * (PLAN section 6.8).
 */
suite("G3: blocked advances pause with accurate reason codes", () => {
  beforeAll(async () => {
    testDb = await createTestDb("pause_reasons");
  });
  afterAll(async () => {
    await testDb.cleanup();
  });

  function openRow(advanceId: string) {
    return listOpenAdvances(testDb.db).then(
      (rows) => rows.find((a) => a.id === advanceId) ?? null,
    );
  }

  it("pauses COLLECTION_SCAN_INCOMPLETE when coverage is missing, resumes after backfill", async () => {
    const { harness, advance, wallet } = await seedAdvanceHarness(testDb, {
      principalWhole: 100,
    });
    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);
    expect((await openRow(advance.id))!.state).toBe("active");

    // No ingestion at all: no coverage, no snapshots, no budget.
    harness.setTime(ANCHOR_SEC + PERIOD_SECONDS + 600);
    await createBudgets(harness.ctx);
    const health = await pauseOnBlocked(harness.ctx);
    expect(
      health.paused.some((p) => p.reason === "COLLECTION_SCAN_INCOMPLETE"),
    ).toBe(true);
    const paused = (await openRow(advance.id))!;
    expect(paused.state).toBe("paused");
    expect(paused.pauseReasonCode).toBe("COLLECTION_SCAN_INCOMPLETE");

    // Backfill arrives (operator re-scan): data becomes complete => resume.
    harness.adapter.setLedger([
      saleInWindow(0, 100, PAYER_1, wallet),
      dripInWindow(1, wallet),
    ]);
    await ingestReceipts(harness.ctx);
    await createBudgets(harness.ctx);
    const healed = await pauseOnBlocked(harness.ctx);
    expect(healed.resumed).toContain(advance.id);
    expect((await openRow(advance.id))!.state).toBe("active");
  });

  it("pauses COLLECTION_AUTHORIZATION_REVOKED on a chain-revoked key and resumes when valid again", async () => {
    const { harness, advance, keyAddress } = await seedAdvanceHarness(testDb, {
      principalWhole: 100,
    });
    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);
    harness.adapter.setAuthorizationReads(
      [
        {
          state: "revoked",
          remainingPeriodAllowance: null,
          currentPeriodEndSec: null,
          expirySec: null,
        },
      ],
      keyAddress,
    );
    const health = await pauseOnBlocked(harness.ctx);
    expect(
      health.paused.some(
        (p) => p.reason === "COLLECTION_AUTHORIZATION_REVOKED",
      ),
    ).toBe(true);
    expect((await openRow(advance.id))!.pauseReasonCode).toBe(
      "COLLECTION_AUTHORIZATION_REVOKED",
    );

    harness.adapter.setAuthorizationReads(
      [
        {
          state: "valid",
          remainingPeriodAllowance: "1000000000",
          currentPeriodEndSec: null,
          expirySec: null,
        },
      ],
      keyAddress,
    );
    const healed = await pauseOnBlocked(harness.ctx);
    expect(healed.resumed).toContain(advance.id);
    expect((await openRow(advance.id))!.state).toBe("active");
  });

  it("pauses COLLECTION_AUTHORIZATION_EXPIRED on an expired key", async () => {
    const { harness, advance, keyAddress } = await seedAdvanceHarness(testDb, {
      principalWhole: 100,
    });
    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);
    harness.adapter.setAuthorizationReads(
      [
        {
          state: "expired",
          remainingPeriodAllowance: null,
          currentPeriodEndSec: null,
          expirySec: ANCHOR_SEC,
        },
      ],
      keyAddress,
    );
    await pauseOnBlocked(harness.ctx);
    expect((await openRow(advance.id))!.pauseReasonCode).toBe(
      "COLLECTION_AUTHORIZATION_EXPIRED",
    );
  });

  it("never funds, and flags NOT_VALID, without a confirmed authorization", async () => {
    const { harness, advance } = await seedAdvanceHarness(testDb, {
      principalWhole: 100,
      withAuthorization: false,
    });
    harness.setTime(ANCHOR_SEC);
    await fundAdvances(harness.ctx);
    // funding stays pending without a valid authorization (PLAN 6.2)
    expect((await openRow(advance.id))!.state).toBe("funding_pending");
  });

  it("pauses COLLECTION_WALLET_INSUFFICIENT_BALANCE when the wallet cannot cover the payment", async () => {
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

    // 1 whole unit spendable against a 10-unit budget cap.
    harness.adapter.setBalance(wallet, TOKEN, wholeUnits(1));
    const health = await pauseOnBlocked(harness.ctx);
    expect(
      health.paused.some(
        (p) => p.reason === "COLLECTION_WALLET_INSUFFICIENT_BALANCE",
      ),
    ).toBe(true);
    expect((await openRow(advance.id))!.pauseReasonCode).toBe(
      "COLLECTION_WALLET_INSUFFICIENT_BALANCE",
    );

    // Balance refills => resume.
    harness.adapter.setBalance(wallet, TOKEN, wholeUnits(1000));
    const healed = await pauseOnBlocked(harness.ctx);
    expect(healed.resumed).toContain(advance.id);
  });
});
