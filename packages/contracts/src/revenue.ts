import { z } from "zod";
import { evidenceModeSchema } from "./evidence.js";
import { hexAddressSchema, moneyAmountSchema, hex32Schema } from "./money.js";

/**
 * Half-open UTC window [startSec, endSec) aligned to the chain authorization
 * period (normally 86,400 seconds), not implicitly to midnight.
 */
export const revenueWindowSchema = z.object({
  startSec: z.number().int(),
  endSec: z.number().int(),
});
export type RevenueWindow = z.infer<typeof revenueWindowSchema>;

/** Reference to one on-chain event; (chainId, txHash, logIndex) is the identity. */
export const eventReferenceSchema = z.object({
  chainId: z.number().int().positive(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  logIndex: z.number().int().nonnegative(),
});
export type EventReference = z.infer<typeof eventReferenceSchema>;

export const excludedEventSchema = z.object({
  ref: eventReferenceSchema,
  reasonCode: z.string().min(1),
});
export type ExcludedEvent = z.infer<typeof excludedEventSchema>;

/**
 * Versioned, frozen snapshot of eligible revenue for one collection period.
 * Snapshots are immutable once created; late corrections arrive as later
 * adjustments, never by rewriting a settled snapshot.
 */
export const revenueSnapshotSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  window: revenueWindowSchema,
  includedEvents: z.array(eventReferenceSchema),
  excludedEvents: z.array(excludedEventSchema),
  netEligibleAmount: moneyAmountSchema,
  /** complete = scan coverage for the window is gap-free; incomplete pauses collection rather than reusing stale totals. */
  completeness: z.enum(["complete", "incomplete"]),
  completenessNotes: z.string().max(2000),
  evidenceMode: evidenceModeSchema,
  classificationVersion: z.string().min(1),
  createdAtSec: z.number().int(),
});
export type RevenueSnapshot = z.infer<typeof revenueSnapshotSchema>;

/** Canonical block/ingestion watermark for gap-free idempotent replay. */
export const ingestionCursorSchema = z.object({
  chainId: z.number().int().positive(),
  /** Next block to scan (everything below is done). */
  nextBlockNumber: z.number().int().nonnegative(),
});
export type IngestionCursor = z.infer<typeof ingestionCursorSchema>;

/** One confirmed transfer event as ingested from chain (raw, pre-classification). */
export const transferEventSchema = z.object({
  chainId: z.number().int().positive(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  logIndex: z.number().int().nonnegative(),
  blockNumber: z.number().int().nonnegative(),
  blockHash: hex32Schema,
  timestampSec: z.number().int(),
  from: hexAddressSchema,
  to: hexAddressSchema,
  tokenAddress: hexAddressSchema,
  amountBaseUnits: moneyAmountSchema,
});
export type TransferEvent = z.infer<typeof transferEventSchema>;
