import {
  markIntentBroadcast,
  markIntentFailed,
  markIntentSubmitting,
  markIntentUnresolved,
  reconcileIntent,
  type PaymentIntentRow,
} from "@float/db";
import {
  UnresolvedSubmitError,
  type PaymentIntent,
  type PaymentOutcome,
} from "@float/contracts";
import type { WorkerContext } from "../context.js";

export type BroadcastOutcome =
  | { status: "confirmed" }
  | { status: "unresolved"; detail: string }
  | { status: "failed"; reasonCode: string; detail: string };

/** Adapter-shaped view of a persisted intent (contracts PaymentIntent). */
export function toContractIntent(row: PaymentIntentRow): PaymentIntent {
  return {
    id: row.id,
    kind: row.kind,
    idempotencyKey: row.idempotencyKey,
    advanceId: row.advanceId,
    budgetId: row.budgetId,
    amount: row.amount.toString(10),
    state: row.state,
    txHash: row.txHash,
    nonceKey: row.nonceKey,
    createdAtSec: Math.floor(row.createdAt.getTime() / 1000),
    updatedAtSec: Math.floor(row.updatedAt.getTime() / 1000),
  };
}

/**
 * The single broadcast flow used by funding AND collection:
 *   journal submitting (prepared -> submitted)
 *     -> adapter.preparePayment (preflight, no state change)
 *     -> adapter.submitPayment
 *     -> persist tx identity (markIntentBroadcast)
 *     -> one reconcile attempt of the known transaction.
 *
 * Failure semantics (PLAN section 6.6):
 *  - UnresolvedSubmitError (timeout/lost response): intent -> unresolved, the
 *    known txHash (when any) is persisted, the reservation is KEPT. Never an
 *    automatic failure, never a replacement payment.
 *  - Definitive protocol rejection (decoded error): intent -> failed,
 *    reservation released; a failed funding intent sends the advance to
 *    funding_failed.
 *  - Any other error is rethrown for job-level logging; nothing is assumed.
 */
export async function broadcastAndReconcile(
  ctx: WorkerContext,
  intentRow: PaymentIntentRow,
  parties: { from: string; to: string },
  opts: { tokenAddress: string },
): Promise<BroadcastOutcome> {
  const intent = toContractIntent(intentRow);
  if (intentRow.state === "prepared") {
    await markIntentSubmitting(ctx.db, intentRow.id);
  }
  try {
    await ctx.adapter.preparePayment(intent, {
      from: parties.from,
      to: parties.to,
      tokenAddress: opts.tokenAddress,
    });
    const { txHash } = await ctx.adapter.submitPayment({
      intent,
      from: parties.from,
      to: parties.to,
      tokenAddress: opts.tokenAddress,
    });
    await markIntentBroadcast(ctx.db, {
      intentId: intentRow.id,
      txHash,
      nonceKey: intent.nonceKey,
    });
    const outcome: PaymentOutcome = await ctx.adapter.reconcilePayment(txHash);
    await reconcileIntent(ctx.db, { intentId: intentRow.id, outcome });
    return outcome.status === "confirmed"
      ? { status: "confirmed" }
      : outcome.status === "failed"
        ? {
            status: "failed",
            reasonCode: outcome.reasonCode,
            detail: outcome.detail ?? "",
          }
        : { status: "unresolved", detail: outcome.detail ?? "outcome pending" };
  } catch (err) {
    if (err instanceof UnresolvedSubmitError) {
      await markIntentUnresolved(ctx.db, {
        intentId: intentRow.id,
        txHash: err.txHash,
        detail: err.message,
      });
      return { status: "unresolved", detail: err.message };
    }
    const protocolReason = (err as { protocolReason?: string }).protocolReason;
    if (typeof protocolReason === "string" && protocolReason.length > 0) {
      await markIntentFailed(ctx.db, {
        intentId: intentRow.id,
        reasonCode: protocolReason,
        detail: err instanceof Error ? err.message : String(err),
        txHash: null,
      });
      return {
        status: "failed",
        reasonCode: protocolReason,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    throw err;
  }
}
