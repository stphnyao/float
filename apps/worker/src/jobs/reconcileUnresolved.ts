import { findReconcilableIntents, reconcileIntent } from "@float/db";
import type { WorkerContext } from "../context.js";

export interface ReconcileUnresolvedResult {
  job: "reconcileUnresolved";
  reconciled: number;
  applied: number;
  keptUnresolved: number;
  terminalFailures: number;
}

/**
 * Reconciles EVERY intent with an unknown outcome and a known transaction
 * identity (state submitted|unresolved, txHash persisted). This is the ONLY
 * recovery path for a lost response or a crash after broadcast:
 *   - the SAME transaction is reconciled via adapter.reconcilePayment;
 *   - a confirmed outcome applies its ledger effect exactly once per txHash;
 *   - an unresolved/pending outcome keeps the reservation (never auto-fail);
 *   - there is NEVER a blind retry with a new economic payment here.
 *
 * Intents submitted WITHOUT a persisted txHash (crash in the tiny window
 * between broadcast and ack) cannot be reconciled by hash; they are left for
 * the adapter's nonce-safe re-submission semantics / operator review — see
 * HANDOFF.md.
 */
export async function reconcileUnresolved(
  ctx: WorkerContext,
): Promise<ReconcileUnresolvedResult> {
  const intents = await findReconcilableIntents(ctx.db);
  const result: ReconcileUnresolvedResult = {
    job: "reconcileUnresolved",
    reconciled: 0,
    applied: 0,
    keptUnresolved: 0,
    terminalFailures: 0,
  };
  for (const intent of intents) {
    if (!intent.txHash) continue;
    result.reconciled += 1;
    const outcome = await ctx.adapter.reconcilePayment(intent.txHash);
    const appliedResult = await reconcileIntent(ctx.db, {
      intentId: intent.id,
      outcome,
    });
    if (
      appliedResult.kind === "applied" ||
      appliedResult.kind === "already-applied"
    ) {
      result.applied += 1;
    } else if (appliedResult.kind === "kept-unresolved") {
      result.keptUnresolved += 1;
    } else if (appliedResult.kind === "intent-failed-terminal") {
      result.terminalFailures += 1;
    }
  }
  return result;
}
