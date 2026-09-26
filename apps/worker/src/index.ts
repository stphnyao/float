import { resolveDatabaseUrl } from "@float/db";

/**
 * One persistent worker owns: receipt ingestion, funding, collection, and
 * reconciliation (work package D). Invariants it must uphold live in
 * PLAN.md section 6 — notably: persist intent + reservation + transaction
 * identity before broadcast; an unresolved transaction blocks new collection
 * for its advance until reconciled; only reconciled events move money state.
 */
async function main() {
  const hasDb = Boolean(process.env.DATABASE_URL);
  console.log(
    `[float-worker] starting; DATABASE_URL ${hasDb ? "set" : "unset (default local)"} (${resolveDatabaseUrl().replace(/:\/\/.*@/, "://***@")})`,
  );
  console.log(
    "[float-worker] no jobs registered yet — package D implements ingestion/funding/collection/reconciliation",
  );
}

main().catch((err) => {
  console.error("[float-worker] fatal", err);
  process.exit(1);
});
