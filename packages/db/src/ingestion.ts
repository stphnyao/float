import { and, asc, eq, gte, lt, or, sql } from "drizzle-orm";
import type { IngestionCursor, TransferEvent } from "@float/contracts";
import type { Db } from "./client.js";
import {
  ingestionCursors,
  receiptEvents,
  type ingestionCursors as cursorsTable,
} from "./schema.js";
import type { DbOrTx } from "./tx.js";

export type IngestionCursorRow = typeof cursorsTable.$inferSelect;

/**
 * Coverage for one (chainId, tokenAddress) scanner. The frozen adapter
 * contract returns only confirmed events plus the next cursor, so coverage is
 * derived CONSERVATIVELY from observed event timestamps: we claim to know the
 * chain only where we have seen events. A revenue window is complete only
 * when fully inside [coverageStartSec, coverageEndSec].
 */
export interface ScanCoverage {
  startSec: number;
  endSec: number;
}

export async function getOrCreateCursor(
  db: DbOrTx,
  chainId: number,
  tokenAddress: string,
  startBlockNumber = 0,
): Promise<IngestionCursorRow> {
  const inserted = await db
    .insert(ingestionCursors)
    .values({
      chainId,
      tokenAddress,
      nextBlockNumber: startBlockNumber,
      coverageStartSec: null,
      coverageEndSec: null,
    })
    .onConflictDoNothing({
      target: [ingestionCursors.chainId, ingestionCursors.tokenAddress],
    })
    .returning();
  if (inserted[0]) return inserted[0];
  const rows = await db
    .select()
    .from(ingestionCursors)
    .where(
      and(
        eq(ingestionCursors.chainId, chainId),
        eq(ingestionCursors.tokenAddress, tokenAddress),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("ingestion cursor missing");
  return row;
}

/**
 * Idempotent raw-event upsert keyed on the chain identity
 * (chainId, txHash, logIndex). Replaying the same log is a no-op (G3 matrix:
 * duplicate event ingestion must never double revenue). Returns the rows
 * that were newly inserted.
 */
export async function upsertReceiptEvents(
  db: DbOrTx,
  events: TransferEvent[],
): Promise<(typeof receiptEvents.$inferSelect)[]> {
  if (events.length === 0) return [];
  const inserted = await db
    .insert(receiptEvents)
    .values(
      events.map((event) => ({
        chainId: event.chainId,
        txHash: event.txHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        blockHash: event.blockHash,
        blockTimestamp: new Date(event.timestampSec * 1000),
        sender: event.from,
        recipient: event.to,
        tokenAddress: event.tokenAddress,
        amountBaseUnits: BigInt(event.amountBaseUnits),
      })),
    )
    .onConflictDoNothing({
      target: [
        receiptEvents.chainId,
        receiptEvents.txHash,
        receiptEvents.logIndex,
      ],
    })
    .returning();
  return inserted;
}

/**
 * Advances the cursor and widens the observed coverage window. Coverage is
 * monotone: start moves only left, end only right. Caller passes the min/max
 * event timestamp observed in the scanned range.
 */
export async function commitCursorProgress(
  db: DbOrTx,
  cursorId: string,
  nextBlockNumber: number,
  observed: { minTimestampSec: number | null; maxTimestampSec: number | null },
): Promise<IngestionCursorRow> {
  const rows = await db
    .update(ingestionCursors)
    .set({
      nextBlockNumber,
      coverageStartSec:
        observed.minTimestampSec === null
          ? sql`ingestion_cursors.coverage_start_sec`
          : sql`least(ingestion_cursors.coverage_start_sec, ${observed.minTimestampSec})`,
      coverageEndSec:
        observed.maxTimestampSec === null
          ? sql`ingestion_cursors.coverage_end_sec`
          : sql`greatest(ingestion_cursors.coverage_end_sec, ${observed.maxTimestampSec})`,
      updatedAt: new Date(),
    })
    .where(eq(ingestionCursors.id, cursorId))
    .returning();
  const row = rows[0];
  if (!row) throw new Error("ingestion cursor missing");
  return row;
}

/** Direct cursor setter for operator backfills/tests (e.g. re-scan from 0). */
export async function resetCursorToBlock(
  db: DbOrTx,
  cursorId: string,
  nextBlockNumber: number,
): Promise<void> {
  await db
    .update(ingestionCursors)
    .set({ nextBlockNumber, updatedAt: new Date() })
    .where(eq(ingestionCursors.id, cursorId));
}

export function cursorRowToContract(row: IngestionCursorRow): IngestionCursor {
  return { chainId: row.chainId, nextBlockNumber: row.nextBlockNumber };
}

export async function getCoverage(
  db: DbOrTx,
  chainId: number,
  tokenAddress: string,
): Promise<ScanCoverage | null> {
  const row = await getOrCreateCursor(db, chainId, tokenAddress);
  if (row.coverageStartSec === null || row.coverageEndSec === null) return null;
  return { startSec: row.coverageStartSec, endSec: row.coverageEndSec };
}

/**
 * Raw events for snapshot building: every tracked-token event involving the
 * merchant (incoming receipts AND outgoing normalized refunds) whose block
 * timestamp falls in [fromSec, toSec). Negative amounts are canonical refund
 * adjustments (adapter-normalized), stored as ingested.
 */
export async function loadEventsForMerchant(
  db: DbOrTx,
  input: {
    chainId: number;
    tokenAddress: string;
    merchantAddress: string;
    fromSec: number;
    toSec: number;
  },
): Promise<TransferEvent[]> {
  const rows = await db
    .select()
    .from(receiptEvents)
    .where(
      and(
        eq(receiptEvents.chainId, input.chainId),
        eq(receiptEvents.tokenAddress, input.tokenAddress),
        or(
          eq(receiptEvents.recipient, input.merchantAddress),
          eq(receiptEvents.sender, input.merchantAddress),
        ),
        gte(receiptEvents.blockTimestamp, new Date(input.fromSec * 1000)),
        lt(receiptEvents.blockTimestamp, new Date(input.toSec * 1000)),
      ),
    )
    .orderBy(asc(receiptEvents.blockTimestamp), asc(receiptEvents.logIndex));
  return rows.map((row) => ({
    chainId: row.chainId,
    txHash: row.txHash,
    logIndex: row.logIndex,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    timestampSec: Math.floor(row.blockTimestamp.getTime() / 1000),
    from: row.sender,
    to: row.recipient,
    tokenAddress: row.tokenAddress,
    amountBaseUnits: row.amountBaseUnits.toString(10),
  }));
}
