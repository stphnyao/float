import { and, eq, inArray } from "drizzle-orm";
import type { EventReference } from "@float/contracts";
import type { Db } from "./client.js";
import { LedgerError } from "./errors.js";
import {
  ledgerEntries,
  receiptClassifications,
  receiptEvents,
  revenueSnapshots,
  type revenueSnapshots as snapshotsTable,
} from "./schema.js";
import type { DbOrTx } from "./tx.js";

export type RevenueSnapshotRow = typeof snapshotsTable.$inferSelect;

/**
 * A pipeline-produced snapshot ready to freeze. The ledger layer is
 * deliberately agnostic of WHO classified (policy v1, a stub, a future v2) —
 * it persists whatever the injected pipeline produced, once per window.
 */
export interface PersistableSnapshot {
  /** Deterministic pipeline id (uuid-shaped); first freeze wins. */
  id: string;
  merchantId: string;
  windowStartSec: number;
  windowEndSec: number;
  netEligibleAmount: bigint;
  completeness: "complete" | "incomplete";
  completenessNotes: string;
  evidenceMode: "synthetic_fixture" | "observed_testnet";
  classificationVersion: string;
  includedEvents: EventReference[];
  excludedEvents: { ref: EventReference; reasonCode: string }[];
}

export interface PersistableClassification {
  ref: EventReference;
  eligible: boolean;
  reasonCode: string;
  provenance: string;
  evidenceMode: "synthetic_fixture" | "observed_testnet";
}

/**
 * Freezes a snapshot. Rules:
 * - Only COMPLETE snapshots are persisted. Incomplete windows are left
 *   unpersisted so a later gap-free rebuild can freeze them (a scan gap must
 *   pause collection, never freeze stale/short data).
 * - Complete snapshots are insert-once per (merchant, windowStart): the
 *   unique index `revenue_snapshots_merchant_window_once` is the arbiter and
 *   the FIRST freeze wins. Settled windows are never rewritten (PLAN
 *   section 3: late corrections arrive as append-only adjustments applied to
 *   a LATER unprocessed window, produced by the pipeline).
 * Returns true when this call created the snapshot.
 */
export async function persistSnapshot(
  db: DbOrTx,
  snapshot: PersistableSnapshot,
  classifications: PersistableClassification[] = [],
): Promise<boolean> {
  if (snapshot.completeness !== "complete") return false;
  const inserted = await db
    .insert(revenueSnapshots)
    .values({
      id: snapshot.id,
      merchantId: snapshot.merchantId,
      windowStart: new Date(snapshot.windowStartSec * 1000),
      windowEnd: new Date(snapshot.windowEndSec * 1000),
      includedEvents: snapshot.includedEvents,
      excludedEvents: snapshot.excludedEvents.map((e) => ({
        ref: e.ref,
        reasonCode: e.reasonCode,
      })),
      netEligibleAmount: snapshot.netEligibleAmount,
      completeness: snapshot.completeness,
      completenessNotes: snapshot.completenessNotes,
      evidenceMode: snapshot.evidenceMode,
      classificationVersion: snapshot.classificationVersion,
    })
    .onConflictDoNothing({
      target: [revenueSnapshots.merchantId, revenueSnapshots.windowStart],
    })
    .returning({ id: revenueSnapshots.id });
  const created = Boolean(inserted[0]);

  if (created && classifications.length > 0) {
    await persistClassifications(db, snapshot.evidenceMode, classifications);
  }
  return created;
}

/**
 * Persists per-event classification decisions (version, reason, provenance)
 * so raw chain events and classification decisions are stored separately
 * (PLAN section 4). Version is a reclassification counter (1 = first);
 * the pipeline's version string lives on the snapshot.
 */
export async function persistClassifications(
  db: DbOrTx,
  evidenceMode: "synthetic_fixture" | "observed_testnet",
  classifications: PersistableClassification[],
  version = 1,
): Promise<void> {
  if (classifications.length === 0) return;
  const refs = classifications.map((c) => c.ref);
  const eventRows = await db
    .select({
      id: receiptEvents.id,
      txHash: receiptEvents.txHash,
      logIndex: receiptEvents.logIndex,
    })
    .from(receiptEvents)
    .where(
      and(
        eq(receiptEvents.chainId, refs[0]!.chainId),
        inArray(
          receiptEvents.txHash,
          refs.map((r) => r.txHash),
        ),
      ),
    );
  const idByRef = new Map(
    eventRows.map((row) => [`${row.txHash}:${row.logIndex}`, row.id] as const),
  );
  const values = classifications
    .map((c) => {
      const eventId = idByRef.get(`${c.ref.txHash}:${c.ref.logIndex}`);
      if (!eventId) return null; // event not ingested; classification not addressable
      return {
        eventId,
        version,
        eligible: c.eligible,
        reasonCode: c.reasonCode,
        provenance: c.provenance,
        reviewStatus: "auto",
        evidenceMode,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
  if (values.length === 0) return;
  await db
    .insert(receiptClassifications)
    .values(values)
    .onConflictDoNothing({
      target: [receiptClassifications.eventId, receiptClassifications.version],
    });
}

export async function getSnapshotForWindowStart(
  db: DbOrTx,
  merchantId: string,
  windowStartSec: number,
): Promise<RevenueSnapshotRow | null> {
  const rows = await db
    .select()
    .from(revenueSnapshots)
    .where(
      and(
        eq(revenueSnapshots.merchantId, merchantId),
        eq(revenueSnapshots.windowStart, new Date(windowStartSec * 1000)),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Window starts already frozen for the merchant (the settled set). */
export async function listFrozenWindowStartsSec(
  db: DbOrTx,
  merchantId: string,
): Promise<number[]> {
  const rows = await db
    .select({ start: revenueSnapshots.windowStart })
    .from(revenueSnapshots)
    .where(eq(revenueSnapshots.merchantId, merchantId));
  return rows.map((r) => Math.floor(r.start.getTime() / 1000));
}

/**
 * Confirmed outstanding recomputed from the reconciled ledger only. Used by
 * invariant tests: the running column must equal
 * obligation + sum(repayment ledger amounts) (repayments are negative).
 * This helper intentionally reads ONLY ledger_entries — never reservations
 * or intents — because balances derive exclusively from reconciled ledger.
 */
export async function assertOutstandingMatchesLedger(
  db: Db,
  advanceId: string,
  obligationAmount: bigint,
  confirmedOutstandingAmount: bigint,
): Promise<void> {
  const rows = await db
    .select({ kind: ledgerEntries.kind, amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.advanceId, advanceId));
  let net = 0n;
  for (const row of rows) {
    if (row.kind === "repayment")
      net += row.amount; // negative entries
    else if (row.kind === "adjustment") net += row.amount;
    // disbursements do not change the repayment obligation
  }
  const derived = obligationAmount + net;
  if (derived !== confirmedOutstandingAmount) {
    throw new LedgerError(
      "INTERNAL_UNEXPECTED",
      `outstanding drift: ledger-derived ${derived} != column ${confirmedOutstandingAmount}`,
    );
  }
}
