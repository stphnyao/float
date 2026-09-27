import { and, desc, eq } from "drizzle-orm";
import {
  authorizations,
  type authorizations as authorizationsTable,
} from "./schema.js";
import type { DbOrTx } from "./tx.js";

export type AuthorizationRow = typeof authorizationsTable.$inferSelect;

/** The authorization bound to an advance (single delegated key per advance). */
export async function getAuthorizationForAdvance(
  db: DbOrTx,
  advanceId: string,
): Promise<AuthorizationRow | null> {
  const rows = await db
    .select()
    .from(authorizations)
    .where(and(eq(authorizations.advanceId, advanceId)))
    .orderBy(desc(authorizations.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Confirms an authorization on chain evidence (state valid + confirmedAt).
 * Funding requires this BEFORE any disbursement (PLAN section 6.2).
 */
export async function confirmAuthorization(
  db: DbOrTx,
  authorizationId: string,
  at: Date,
): Promise<void> {
  await db
    .update(authorizations)
    .set({ state: "valid", confirmedAt: at, updatedAt: at })
    .where(eq(authorizations.id, authorizationId));
}

/** Records a chain-confirmed revocation (independent of advance state). */
export async function markAuthorizationRevoked(
  db: DbOrTx,
  authorizationId: string,
  revokedTxHash: string | null,
  at: Date,
): Promise<void> {
  await db
    .update(authorizations)
    .set({
      state: "revoked",
      revokedTxHash,
      revokedConfirmedAt: at,
      updatedAt: at,
    })
    .where(eq(authorizations.id, authorizationId));
}
