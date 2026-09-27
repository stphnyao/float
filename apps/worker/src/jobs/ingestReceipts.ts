import {
  commitCursorProgress,
  cursorRowToContract,
  getOrCreateCursor,
  upsertReceiptEvents,
} from "@float/db";
import type { WorkerContext } from "../context.js";

export interface IngestReceiptsResult {
  job: "ingestReceipts";
  observedEvents: number;
  insertedEvents: number;
  nextBlockNumber: number;
  coverage: { startSec: number | null; endSec: number | null };
  coverageTruncated: boolean;
}

/**
 * Receipt ingestion (PLAN section 4): cursor-based, gap-free, idempotent.
 *
 * Two passes over the SAME cursor:
 *  - receipts pass: transfers TO the merchant (sales, faucet drips, Float
 *    disbursements, self-funding — classification excludes non-sales);
 *  - refund pass: transfers FROM the merchant, normalized by the adapter to
 *    negative-amount events (canonical refund adjustments).
 *
 * Idempotency: events are upserted on (chainId, txHash, logIndex); replaying
 * a range can never double-count revenue. Coverage is tracked in
 * ingestion_cursors and derived conservatively from observed event
 * timestamps; a scanner that reports a cursor ahead of events it returned
 * (an inconsistent batch) truncates coverage at the hole so affected windows
 * are treated as incomplete (pause, never reuse stale totals).
 */
export async function ingestReceipts(
  ctx: WorkerContext,
): Promise<IngestReceiptsResult> {
  const { chainId, tokenAddress } = ctx.config.chain;
  const merchantAddress = ctx.config.merchantAddress;

  const cursorRow = await getOrCreateCursor(
    ctx.db,
    chainId,
    tokenAddress,
    ctx.config.ingestStartBlock,
  );
  const cursor = cursorRowToContract(cursorRow);

  const receipts = await ctx.adapter.ingestTransfers(cursor, {
    tokenAddress,
    recipients: [merchantAddress],
  });
  const refunds = await ctx.adapter.ingestTransfers(cursor, {
    tokenAddress,
    senders: [merchantAddress],
  });

  const events = [...receipts.events, ...refunds.events];
  const inserted = await upsertReceiptEvents(ctx.db, events);

  // Advance to the further of the two returned cursors.
  const nextBlockNumber = Math.max(
    receipts.nextCursor.nextBlockNumber,
    refunds.nextCursor.nextBlockNumber,
  );

  // Gap/inconsistency detection: an event at or beyond the returned cursor
  // means the scanner skipped data it reported as scanned. Truncate the
  // coverage end just before the hole so windows touching it stay incomplete.
  const inconsistent = events.filter(
    (event) => event.blockNumber >= nextBlockNumber,
  );
  const coverageTruncated = inconsistent.length > 0;

  const observedTs = events.map((event) => event.timestampSec);
  const minTs = observedTs.length > 0 ? Math.min(...observedTs) : null;
  let maxTs = observedTs.length > 0 ? Math.max(...observedTs) : null;
  if (coverageTruncated && maxTs !== null) {
    maxTs = Math.min(
      maxTs,
      Math.min(...inconsistent.map((event) => event.timestampSec)) - 1,
    );
  }

  const updated = await commitCursorProgress(
    ctx.db,
    cursorRow.id,
    nextBlockNumber,
    {
      minTimestampSec: minTs,
      maxTimestampSec: maxTs,
    },
  );

  return {
    job: "ingestReceipts",
    observedEvents: events.length,
    insertedEvents: inserted.length,
    nextBlockNumber: updated.nextBlockNumber,
    coverage: {
      startSec: updated.coverageStartSec,
      endSec: updated.coverageEndSec,
    },
    coverageTruncated,
  };
}
