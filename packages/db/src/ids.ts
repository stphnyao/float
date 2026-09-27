/**
 * Stable business idempotency keys for payment intents (PLAN section 6.4).
 * A key is derived from durable business identities only — never from time,
 * job runs, or randomness — so a duplicate request, retried job, or restarted
 * worker resolves to the SAME intent instead of a second economic payment.
 */

/** One funding intent per advance, ever. */
export function fundingIntentKey(advanceId: string): string {
  return `funding:v1:${advanceId}`;
}

/**
 * One collection intent per advance per collection budget (one per anchored
 * period). Two concurrent job triggers compute the same key; the unique
 * index plus the per-advance advisory lock make the second call return the
 * existing intent.
 */
export function collectionIntentKey(
  advanceId: string,
  budgetId: string,
): string {
  return `collection:v1:${advanceId}:${budgetId}`;
}
