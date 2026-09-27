import {
  getIntentByIdempotencyKey,
  getAuthorizationForAdvance,
  listOpenAdvances,
  fundingIntentKey,
  type AdvanceRow,
  type AuthorizationRow,
} from "@float/db";
import type { Authorization, AuthorizationRead } from "@float/contracts";
import type { WorkerContext } from "../context.js";
import { broadcastAndReconcile } from "./broadcast.js";

export interface FundAdvancesResult {
  job: "fundAdvances";
  funded: number;
  skipped: { advanceId: string; reason: string }[];
}

export function toContractAuthorization(row: AuthorizationRow): Authorization {
  return {
    id: row.id,
    merchantId: row.merchantId,
    advanceId: row.advanceId,
    chainId: row.chainId,
    tokenAddress: row.tokenAddress,
    chainAccountAddress: null,
    keyAddress: row.keyAddress,
    keyPublicKey: row.keyPublicKey,
    scopes: row.scopes,
    periodSeconds: row.periodSeconds,
    periodCeilingAmount: row.periodCeilingAmount?.toString(10) ?? null,
    expirySec: row.expiresAt
      ? Math.floor(row.expiresAt.getTime() / 1000)
      : null,
    state: row.state,
    authorizationTxHash: row.authorizationTxHash,
    revokedTxHash: row.revokedTxHash,
    witness: null,
    confirmedAtSec: row.confirmedAt
      ? Math.floor(row.confirmedAt.getTime() / 1000)
      : null,
    revokedConfirmedAtSec: row.revokedConfirmedAt
      ? Math.floor(row.revokedConfirmedAt.getTime() / 1000)
      : null,
    createdAtSec: Math.floor(row.createdAt.getTime() / 1000),
    updatedAtSec: Math.floor(row.updatedAt.getTime() / 1000),
  };
}

export async function readAuthorizationChecked(
  ctx: WorkerContext,
  row: AuthorizationRow,
): Promise<AuthorizationRead> {
  return ctx.adapter.readAuthorization(toContractAuthorization(row));
}

/**
 * Funding job: drives funding_pending advances to active. Order of gates:
 *  1. the advance must have a confirmed authorization on file (PLAN 6.2:
 *     verify confirmed authorization matches before funding);
 *  2. the live authorization must read valid and unexpired;
 *  3. the stable-keyed funding intent is broadcast via the shared flow.
 *
 * funding_pending -> active happens ONLY in db.reconcileIntent when the
 * funding transaction reconciles CONFIRMED — a submitted or unresolved
 * broadcast never activates repayment (PLAN 6.7).
 */
export async function fundAdvances(
  ctx: WorkerContext,
): Promise<FundAdvancesResult> {
  const nowSec = ctx.nowSec();
  const pending = (await listOpenAdvances(ctx.db)).filter(
    (advance) => advance.state === "funding_pending",
  );
  const skipped: { advanceId: string; reason: string }[] = [];
  let funded = 0;

  for (const advance of pending as AdvanceRow[]) {
    const intent = await getIntentByIdempotencyKey(
      ctx.db,
      fundingIntentKey(advance.id),
    );
    if (!intent || intent.state !== "prepared") {
      skipped.push({
        advanceId: advance.id,
        reason: intent ? `intent ${intent.state}` : "no funding intent",
      });
      continue;
    }
    const authRow = await getAuthorizationForAdvance(ctx.db, advance.id);
    if (!authRow || authRow.state !== "valid") {
      skipped.push({
        advanceId: advance.id,
        reason: "COLLECTION_AUTHORIZATION_NOT_VALID",
      });
      continue;
    }
    const read = await readAuthorizationChecked(ctx, authRow);
    if (read.state !== "valid") {
      skipped.push({
        advanceId: advance.id,
        reason: `chain auth ${read.state}`,
      });
      continue;
    }
    if (read.expirySec !== null && read.expirySec <= nowSec) {
      skipped.push({
        advanceId: advance.id,
        reason: "COLLECTION_AUTHORIZATION_EXPIRED",
      });
      continue;
    }

    const outcome = await broadcastAndReconcile(
      ctx,
      intent,
      // Treasury pays the merchant principal.
      { from: advance.treasuryAddress, to: advance.merchantAddress },
      { tokenAddress: advance.tokenAddress },
    );
    if (outcome.status === "confirmed") funded += 1;
    else skipped.push({ advanceId: advance.id, reason: outcome.status });
  }

  return { job: "fundAdvances", funded, skipped };
}
