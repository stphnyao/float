import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

/**
 * A transaction handle. Drizzle's node-postgres transaction callback receives
 * a PgTransaction that is structurally compatible with the Db query builder
 * for the statements we use; repository functions accept either so they can
 * compose inside a caller's transaction.
 */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/**
 * Per-advance transaction-scoped advisory lock (PLAN section 3: "hold a
 * per-advance database lock" before reserving a payment). `hashtext` maps the
 * stable advance UUID to a deterministic integer key; the lock is held until
 * the surrounding transaction commits or rolls back. Every money-critical
 * per-advance mutation (reserving, reconciling) takes this SAME lock so
 * concurrent jobs serialize instead of racing the budget/outstanding math.
 */
export async function withAdvanceLock(
  tx: Tx,
  advanceId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${advanceId}))`);
}

/**
 * Runs `fn` inside one transaction with the per-advance advisory lock held.
 * This is the required shape for every financial mutation on an advance.
 * Accepts an outer transaction too (drizzle nests via savepoints).
 */
export async function transactionWithAdvanceLock<T>(
  db: DbOrTx,
  advanceId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await withAdvanceLock(tx, advanceId);
    return fn(tx);
  });
}
