import { eq } from "drizzle-orm";
import { canonicalJson, type OfferTerms } from "@float/contracts";
import { createHash } from "node:crypto";
import type { Db } from "./client.js";
import { ensureMerchant } from "./advances.js";
import { offers, type offers as offersTable } from "./schema.js";
import type { DbOrTx } from "./tx.js";

export type OfferRow = typeof offersTable.$inferSelect;

/**
 * Server-side terms hashing (contracts defines canonicalJson; the hash itself
 * is computed where sha256 is available). Acceptance binds to this hash.
 */
export function hashOfferTerms(terms: OfferTerms): string {
  return createHash("sha256")
    .update(canonicalJson(terms))
    .digest("hex")
    .replace(/^/, "0x");
}

export interface InsertOfferInput {
  merchantWalletAddress: string;
  terms: OfferTerms;
  policyVersion: string;
  snapshotIds: string[];
  decision: "eligible" | "declined" | "insufficient_evidence";
  reasonCodes: string[];
  evidenceMode: "synthetic_fixture" | "observed_testnet";
  /** Offer state; defaults to offered. */
  state?: "offered" | "accepted" | "expired" | "declined";
  now: Date;
  /** Lifetime in seconds from now; default 7 days. */
  ttlSec?: number;
}

export async function insertOffer(
  db: DbOrTx,
  input: InsertOfferInput,
): Promise<OfferRow> {
  const merchant = await ensureMerchant(db, input.merchantWalletAddress);
  const ttl = input.ttlSec ?? 7 * 86_400;
  const rows = await db
    .insert(offers)
    .values({
      merchantId: merchant.id,
      terms: input.terms,
      termsHash: hashOfferTerms(input.terms),
      policyVersion: input.policyVersion,
      snapshotIds: input.snapshotIds,
      decision: input.decision,
      reasonCodes: input.reasonCodes,
      evidenceMode: input.evidenceMode,
      state: input.state ?? "offered",
      expiresAt: new Date(input.now.getTime() + ttl * 1000),
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("offer insert failed");
  return row;
}

export async function getOffer(
  db: DbOrTx,
  offerId: string,
): Promise<OfferRow | null> {
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.id, offerId))
    .limit(1);
  return rows[0] ?? null;
}

/** Marks an accepted offer (advance creation implies acceptance, PLAN section 6). */
export async function markOfferAccepted(
  db: DbOrTx,
  offerId: string,
): Promise<void> {
  await db
    .update(offers)
    .set({ state: "accepted" })
    .where(eq(offers.id, offerId));
}
