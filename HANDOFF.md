# HANDOFF — integration round 1 (work packages B and C)

Combined from both package branches at merge time. C (policy) merged first, then B (chain).

---

# HANDOFF — work package C (receipts/policy)

Branch: `codex/float-policy`. Owner of `packages/policy/` and `fixtures/`.
Policy v1 is frozen in [docs/policy-v1.md](docs/policy-v1.md) BEFORE
implementation; `packages/policy` implements that document. No files outside
the owned paths were modified (see "Boundary notes" for the one deliberate
in-repo addition and the integrator-owned changes I deliberately avoided).

## What was delivered

- `docs/policy-v1.md` — frozen thresholds, score directions, decision mapping,
  classification rule order, refund semantics, sizing formula, reason codes.
- `packages/policy/src/` — pure, I/O-free implementation:
  - `version.ts` (POLICY_VERSION `policy-v1`, all frozen constants, reason codes)
  - `periods.ts` (anchor-based 86,400 s windows, floor-division, coverage merge)
  - `classify.ts` (`classifyEvents`: 12 frozen rules, deterministic order,
    batch-order independent, refunds as adjustments)
  - `snapshots.ts` (`buildRevenueSnapshots`: anchored windows, completeness
    from scan coverage, append-only refund deferral, deterministic ids)
  - `eligibility.ts` (`evaluateEligibility`: decision + reason codes + metrics)
  - `sizing.ts` (`sizeOffer`, `sizeOfferForDecision`, `policyDefaultSizingInputs`)
  - `baseline.ts` (P25 conservative baseline incl. zero-sales days)
  - `hash.ts` (dependency-free deterministic UUID shaping for snapshot ids)
- `fixtures/` — 3 demo + 7 edge-case builders as typed TS with embedded
  expected outcomes (classification counts, decision, reasons, metrics, sizing).
- `packages/policy/tests/` — 116 vitest tests (all passing).
- `fixtures/package.json` — added ONLY to mark the directory `"type": "module"`
  (fixtures/ sits outside any workspace glob, so TS treated it as CommonJS and
  `verbatimModuleSyntax` rejected the ESM syntax). It is not a workspace
  package and pnpm ignores it.

## Commands run and results

- `pnpm install` — exit 0.
- `pnpm typecheck` (workspace) — exit 0.
- `pnpm test` (workspace) — exit 0; `packages/policy`: 7 files, 116 tests passed.
- `pnpm exec prettier --check docs/policy-v1.md fixtures/ packages/policy/` — clean.
- No chain calls, no database, no network. Fully deterministic.

## Frozen policy-v1 summary (full detail in docs/policy-v1.md)

| Dimension                                                  | Threshold                                                                       | Direction        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------- |
| History completeness                                       | 0 incomplete windows in the evaluated series; contiguous window starts required | lower is better  |
| Complete windows                                           | >= 21                                                                           | higher is better |
| Active periods (complete windows with net > 0)             | >= 15                                                                           | higher is better |
| Eligible volume (sum of max(0, net) over complete windows) | >= 300 whole units (scaled by verified decimals)                                | higher is better |
| Payer concentration (top payer share of included volume)   | <= 6000 bps                                                                     | lower is better  |
| Volatility (max active day / mean active day, bps)         | <= 25000 bps                                                                    | lower is better  |
| Suspicious flows (suspected-circular volume)               | 0 (any > 0 declines)                                                            | lower is better  |

- Decisions: `insufficient_evidence` (evidence adequacy) > `declined`
  (quality failures) > `eligible`; all triggered `policy_*` reason codes are
  returned in a frozen order. Nothing is a probability.
- Conservative baseline: P25 (2500 bps) of complete-window
  max(0, netEligibleAmount), ascending, index floor((n-1)*2500/10000),
  zero-sales days included; incomplete windows excluded.
- Sizing: capacity = sum over 14 horizon periods of
  min(floor(rate_bps * baseline / 10000), period_ceiling);
  principal = min(floor(capacity * 5000 bps / 10000), max_principal).
  Defaults: rate 1000 bps, ceiling 100 whole units, haircut 5000 bps,
  max principal 500 whole units, period 86,400 s.

## Boundary notes and integrator-owned items

1. **fixtures/ module type (in-repo, deliberate):** added
   `fixtures/package.json` with `"type": "module"` and name `float-fixtures`
   (private). pnpm-workspace globs were NOT touched. If another package needs
   to import fixtures, the integrator should add `fixtures` to the workspace
   globs (and optionally rename to `@float/fixtures`); fixtures import
   contracts types via relative type-only imports, so today nothing links
   against it.
2. **Refund ingestion path (contracts/adapter usage):** policy v1 canonical
   refund representation is a `TransferEvent` with negative `amountBaseUnits`
   (money.ts already permits this). The frozen `TempoAdapter.ingestTransfers`
   filter only supports `{ tokenAddress, recipients }`, which captures
   merchant-incoming transfers but NOT merchant-outgoing refunds. Work package
   B/D must either add a `senders?: HexAddress[]` option to the filter or run
   a second ingestion pass and normalize refunds to negative-amount events
   before classification. Happy to co-design; I did not edit
   packages/contracts (frozen, integrator-owned).
3. **`packages/policy/package.json`:** `test` script changed from
   `vitest run --passWithNoTests` to `vitest run` (the package now has tests).
   No new dependencies were added (lockfile untouched).
4. **Future contract suggestion (v2, not requested now):** RevenueSnapshot
   could carry per-payer volume aggregation so `evaluateEligibility` would not
   need the `ClassifiedEvent[]` join for concentration. Kept v1 faithful to
   the frozen G0 interfaces.

## Limitations

- Rule heuristics verify rule behavior, not credit accuracy; the suspected-
  circular rule is deliberately conservative (any merchant->payer outgoing
  transfer makes that payer's later inflows ineligible for the whole batch).
- Volatility is measured over active days only (zero days are separately
  penalized by the active-period threshold); the baseline includes zero days.
- Sizing repeats the P25 baseline across the whole horizon (no seasonality);
  the per-period table exists for a v2 to vary it.
- Refunds that never find a later unprocessed window stay deferred
  (returned as `deferredAdjustments`); persisting and later applying them is
  the ledger's (package D) responsibility.
- Windows fully outside the declared scan coverage are not built; merchants
  whose scan span is short fail on the complete-window minimum, which is the
  intended insufficient-evidence behavior.

---

<<<<<<< HEAD

# HANDOFF — Package B (Tempo integration), branch codex/float-chain

Updated 2026-09-26. Integrator: see "Contracts-change requests" before touching
`packages/contracts/` (frozen; Package B did NOT modify it).

## Summary for the integrator

G1 spike evidence is obtained (see spike/RESULTS.md). The typed live adapter is
implemented in packages/chain with unit tests. Everything typechecks and tests
green workspace-wide. Two items need integrator/owner attention:

1. Contracts gap (below) — Authorization DTO lacks the merchant root chain
   address; the adapter currently takes it at construction time.
2. Fee/limit interaction is a product-level fact to reflect in offer terms and
   worker budget math (below), not a code change request.

## Contracts-change requests (do not implement without integrator)

### C1. Authorization: add the merchant root account's chain address

`readAuthorization(authorization)` needs to query the accountKeychain precompile
with `(merchantRootAddress, keyIdAddress)`. The frozen `Authorization` DTO
(packages/contracts/src/authorization.ts) stores `keyAddress` (the delegated
key id) and `keyPublicKey`, but NOT the merchant root's on-chain address
(`merchantId` is an app-level UUID). Package B's adapter therefore requires
`merchantAccountAddress` at `createTempoAdapter` construction time.

Request: add e.g. `chainAccountAddress: hexAddressSchema` (the merchant root
EOA / account address on `chainId`) to `authorizationSchema`, populated when
the authorization is created (the same UX step that generates the delegated
key). Alternative (no schema change): the adapter keeps the constructor
binding, acceptable for the single-merchant demo but wrong for multi-merchant
workers.

### C2 (informational, no change required yet)

`PaymentOutcome.confirmed` carries `feeAmount`/`feePayer` — good; the spike
confirms receipts expose `feeToken` too. If the ledger later needs the fee
token identity per payment, add `feeToken` to the confirmed outcome.

## Behavior facts the rest of the build must absorb (spike-proven)

- Fee payment is limit-enforced for access keys: a key whose limits lack the
  fee token cannot pay fees at all (`SpendingLimitExceeded`). When the fee
  token equals the limit token, fees consume the limit. Float must authorize
  keys with a separate fee-token allowance, and worker budget math must model
  collection amounts only (fees flow through the fee-token allowance).
- Recurring limit period is anchored to authorization time
  (periodEnd = authorize_time + period), not to midnight and not to first
  spend. Persist `currentPeriodEndSec` from `readAuthorization` and align
  collection windows with it (PLAN.md section 3).
- Overspend and scope violations surface as ESTIMATION (preflight) rejections
  with no receipt: `SpendingLimitExceeded()` (raw `0x8a9e71ea`),
  `CallNotAllowed()` (raw `0x576b38b4`), `KeyExpired()`, `KeyAlreadyRevoked()`
  (names observed in revert reason text). There is no transaction hash for
  these; treat them as definitive failures, not unresolved submissions.
- On-chain symbol for the primary token is `alphaUSD` (lowercase), not the
  docs' "AlphaUSD" label. Always read symbols/decimals via
  `adapter.getTokenInfo`.
- Faucet is programmatic and unauthenticated (1M of each test token per
  request) — do not build "funding" UI assumptions that require a login.

## Left for other packages

- packages/db / apps/worker: ingestion cursor persistence, reservations,
  reconciliation loop around `adapter.reconcilePayment` (already typed).
- apps/web: wallet UX (G4 rehearsal with the user's real wallet).
- Package B did not touch apps/, packages/db, packages/policy, fixtures/.
  \=======

# HANDOFF — work package D (ledger/worker)

Branch: `codex/float-ledger` (fast-forwarded from main `84e961c` before work
started; nothing else on the branch). Owner of `packages/db/`,
`apps/worker/`, `tests/integration/`. No files outside the owned paths were
modified except this handoff section.

## What was delivered

### packages/db (typed, transactional repositories — no adapter calls here)

- `src/advances.ts` — `acceptOffer`: one transaction binding offer to
  advance to a single funding intent. Idempotency arbiter = new unique
  index `advances_offer_once`; duplicate acceptance returns the existing
  row (`replayed`), mismatched terms hash / wrong merchant identity reject
  with no mutation; second open advance for a merchant rejects
  ADVANCE_ALREADY_OPEN via `advances_one_open_per_merchant`. Plus
  `setAdvanceState` (STATE_TRANSITIONS-checked, stores accurate
  `pause_reason_code`) and `markRepaidIfSettled` (payoff stop incl.
  paused to active to repaid).
- `src/reservations.ts` — `reserveForCollection`: ONE transaction under
  `pg_advisory_xact_lock(hashtext(advanceId))`; rejects non-active advance
  / inactive budget; returns the EXISTING intent for a duplicate stable
  idempotency key (`collection:v1:{advanceId}:{budgetId}`); blocks new
  collection while an intent is submitted/unresolved; caps the payment by
  BOTH remainders (budget remainder = budget.remaining minus held
  reservations on that budget; outstanding remainder = confirmed
  outstanding minus all held reservations) then inserts intent (prepared) +
  reservation (held) BEFORE any broadcast. Zero cap = no intent.
- `src/payments.ts` — `markIntentSubmitting` / `markIntentBroadcast`
  (tx identity persisted pre/post broadcast) / `markIntentUnresolved`
  (timeout = unresolved, reservation KEPT, hash persisted when known) /
  `markIntentFailed` (definitive decoded rejection = reservation released,
  funding failure = funding_failed) / `reconcileIntent` (alias
  `confirmPayment`): ledger effect applied EXACTLY ONCE per
  (advance, kind, txHash) via partial unique index `ledger_entries_tx_once`;
  confirmed funding = disbursement row + funding_pending to active + period
  anchor = funding confirmation time; confirmed collection = repayment row
  (negative amount) + outstanding decrement + budget debit + reservation
  settled + repaid at zero; duplicate reconciles repair bookkeeping only.
  No exactly-once claim across db+chain: reconcile-once semantics,
  documented.
- `src/budgets.ts` — `createBudgetForPeriod` implementing the frozen PLAN
  section 3 formula budget[p] = min(floor(rate_bps * max(0, receipts[p-1])
  / 10000), ceiling, outstanding_at_creation), idempotent per
  (advance, periodStart) via new unique index; zero-eligible = budget
  frozen at 0, status exhausted. `supersedeExpiredBudgets` (unused expired
  budgets never accumulate).
- `src/ingestion.ts` — cursor row per (chainId, token); `upsertReceiptEvents`
  idempotent on (chainId, txHash, logIndex); conservative coverage tracked
  in `ingestion_cursors.coverage_start_sec/_end_sec` (new columns);
  `loadEventsForMerchant` for snapshot building (receipts + normalized
  refunds).
- `src/snapshots.ts` — `persistSnapshot`: ONLY complete snapshots are
  frozen, insert-once per (merchant, windowStart) via new unique index
  (first freeze wins; incomplete windows stay unfrozen so a gap-free
  rebuild can freeze them); per-event classification rows persisted
  separately from raw events; `assertOutstandingMatchesLedger` invariant
  helper.
- `src/offers.ts`, `src/authorizations.ts`, `src/errors.ts` (LedgerError
  with stable reason codes), `src/ids.ts` (stable idempotency keys),
  `src/tx.ts` (advisory-lock helpers).
- NEW migration `drizzle/0001_tranquil_earthquake.sql` (applied): pause
  reason columns, coverage columns, `advances_offer_once`,
  `collection_budgets_advance_period_once`,
  `revenue_snapshots_merchant_window_once`. The 0000 migration is untouched.

### apps/worker (one persistent loop, jobs as importable functions)

- `src/pipeline.ts` — the classification integration point: the worker
  depends on an injectable `ReceiptPipeline` seam; default impl wraps
  policy v1 (`classifyEvents` + `buildRevenueSnapshots`). When the adapter
  is a fake, `createWorkerContext` FORCES `evidenceMode: synthetic_fixture`
  (a fake can never generate live-looking evidence).
- Jobs (structured results; per-tick failures logged, loop survives):
  `ingestReceipts` (two passes over one cursor: recipients=[merchant] and
  senders=[merchant], the refund pass the adapter normalizes to
  negative-amount events; cursor + conservative coverage; inconsistent
  cursors truncate coverage), `createBudgets` (snapshots for completed
  post-funding windows, then a budget for every period whose receipts
  window completed with a COMPLETE snapshot, incl. the current period),
  `reconcileUnresolved` (reconciles every intent with unknown outcome +
  known txHash; NEVER blind-retries with a new economic payment),
  `fundAdvances` (requires db-confirmed + chain-valid authorization before
  disbursement), `runCollections` (allowance, chain clamp: remaining period
  allowance + spendable balance, reserve, broadcast, reconcile),
  `pauseOnBlocked` (accurate reasons: COLLECTION_UNRESOLVED_PAYMENT /
  _REVOKED / _EXPIRED / _NOT_VALID / COLLECTION_SCAN_INCOMPLETE /
  COLLECTION_WALLET_INSUFFICIENT_BALANCE; resumes when the blocker clears).
- `src/main.ts` — operator-only CLI: `pnpm --filter @float/worker start --
[--once | --job=NAME | --interval-ms=N]`; manual triggers are CLI-only,
  never exposed via read-only paths. Live adapter comes from packages/chain
  and currently fails with B's explicit not-implemented guard.

### tests/integration (vitest + real Postgres)

- Per-test-file SCHEMA harness (`test/testdb.ts`): applies the frozen
  migration SQL with the `"public".` FK qualifiers rewritten to the file's
  schema (drizzle-kit qualifies FKs to public); vitest may run files in
  parallel safely; suites auto-skip when Postgres is unreachable (CI-safe).
- `fakes/fakeTempoAdapter.ts` — `implementation: "fake" as const` (asserted
  in every harness); scripted submit outcomes: success, timeout AFTER
  broadcast (UnresolvedSubmitError WITH txHash), timeout BEFORE broadcast
  (no hash), definitive protocol failure (FakeProtocolError, decoded
  reason); deterministic nonce-safe re-submission (same intent key = same
  txHash); refund-pass normalization to negative-amount events; per-key
  authorization reads; injectable clock.
- `fakes/stubPipeline.ts` — stub classifier for the classification
  integration-point tests (exclusion rules independent of policy v1).

## Commands run and results

- `pnpm install` — exit 0 (lockfile updated for workspace dep additions).
- `pnpm db:generate` + `pnpm db:migrate` — migration 0001 applied to
  postgres:16 @ localhost:54329.
- `pnpm typecheck` (workspace, 9 projects) — exit 0.
- `pnpm test` (workspace) — exit 0: contracts 4, policy 116, e2e 1,
  tests/integration 11 files / 29 tests; db/worker/chain passWithNoTests.
- `pnpm --filter @float/tests-integration test` detail: 11 files, 29 tests,
  all passed (G3 scenarios below).
- `pnpm exec prettier --check` on all owned sources — clean. NOTE:
  `pnpm format:check` at repo root reports pre-existing warnings for ~87
  files on Windows because this checkout has CRLF (OneDrive); untouched
  files are equally affected and CI (LF checkout) is green — pre-existing
  platform artifact, not introduced here.
- `pnpm --filter @float/worker start -- --help` — prints usage; `--job=...`
  without a live adapter fails with the explicit B/G1 guard message.

## G3/G4 matrix (PLAN section 7) — scenario, test, result

| Scenario                                   | Test (tests/integration/test/)                                    | Result                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate acceptance/funding               | g3-duplicate-acceptance-funding.test.ts                           | PASS — replay returns same advance; one funding intent; one disbursement ledger row; duplicate reconcile = already-applied                                                                    |
| Duplicate jobs/concurrent triggers         | g3-concurrent-triggers.test.ts                                    | PASS — 2 concurrent runCollections / reserveForCollection / createBudgets = exactly one intent+reservation+repayment, one budget per period; over-collection request clamped to cap           |
| Crash around broadcast / lost RPC response | g3-crash-before-ack.test.ts                                       | PASS — crash after txHash persistence: fresh run reconciles SAME tx once; rerun no-op; UnresolvedSubmitError keeps reservation, later reconcile applies once, no replacement broadcast        |
| Unresolved across period rollover          | g3-unresolved-rollover.test.ts                                    | PASS — reservation held across rollover; new period collection blocked (UNRESOLVED_BLOCK); health pauses with COLLECTION_UNRESOLVED_PAYMENT; reconcile settles + resumes; new period collects |
| Zero receipts                              | g3-zero-receipts.test.ts                                          | PASS — complete coverage + zero eligible = budgets frozen at 0 (exhausted), ZERO_ELIGIBLE_RECEIPTS skip, no intent/tx, no pause                                                               |
| Incomplete history/scan gap                | g3-pause-reasons.test.ts                                          | PASS — no coverage = COLLECTION_SCAN_INCOMPLETE pause; backfill = resume                                                                                                                      |
| Refund/self-transfer/Float disbursement    | g3-classification-exclusions.test.ts (stub classifier)            | PASS — net = sale minus refund adjustment; exclusions contribute 0; budget/repayment follow net                                                                                               |
| Remaining debt below normal payment        | g3-final-payment.test.ts                                          | PASS — budget capped by outstanding (10 < 20); exact final partial; advance repaid; no post-payoff collection                                                                                 |
| Insufficient balance/revoked/expired key   | g3-pause-reasons.test.ts                                          | PASS — COLLECTION_WALLET_INSUFFICIENT_BALANCE / _REVOKED / _EXPIRED with accurate codes; resume when cleared; no authorization = never funded                                                 |
| Duplicate event/receipt ingestion          | g3-classification-exclusions.test.ts                              | PASS — same range ingested 3x = 0 new rows after first; one frozen snapshot; one budget; one repayment                                                                                        |
| Auth/offer replay or another merchant's ID | g3-offer-replay.test.ts + g3-duplicate-acceptance-funding.test.ts | PASS — expired/declined/wrong-identity/wrong-hash rejected with zero financial rows; replay returns same advance                                                                              |

Plus `funding-activation.test.ts`: funding_pending to active ONLY on
reconciled confirmed funding (submitted/unresolved never activate; anchor =
funding confirmation; protocol failure = funding_failed and the slot frees).

## Limitations (read before building on this)

1. **Crash window between broadcast and txHash persistence.** If the
   process dies between `submitPayment` and `markIntentBroadcast`, the
   intent is `submitted` with `txHash = null` and cannot be reconciled by
   hash. The code never blind-retries; such intents are surfaced for
   operators. The fake models the mitigation (deterministic nonce = same
   txHash per intent key) but the live adapter must actually provide it.
2. **Conservative coverage.** The frozen `ingestTransfers` returns only
   events + cursor, so time coverage is inferred from observed event
   timestamps: a quiet tail after the last sale leaves later windows
   incomplete = pause (never stale reuse). Coverage START is pinned to the
   funding anchor. See contracts-change request 1 for the exact fix.
3. **First freeze wins.** A complete snapshot is frozen once per window;
   late-arriving NEW sales for an already-frozen window are dropped
   (documented demo simplification). Refunds are append-only adjustments
   applied by the pipeline to a later unprocessed window (policy v1
   semantics), so settled budgets are never rewritten.
4. **submitted-without-hash recovery** relies on the adapter's nonce-safe
   re-submission for funding only; collections in that state wait for
   operator review rather than risk a double collect.
5. Tests use accelerated 3600 s simulated periods with an injected clock —
   explicitly NOT evidence of a 24-hour chain rollover (PLAN section 3).
6. Budget recomputation re-classifies the merchant's events each tick
   (deterministic, self-consistent; O(n) per tick — fine for demo scale).

## Contracts-change requests (integrator/A to decide; nothing changed by D)

1. **`TempoAdapter.ingestTransfers` should return scanned coverage** — e.g.
   `nextCursor` plus `scanned: { fromBlock, toBlock, blockTimeSec? }[]` or a
   head timestamp. The ledger currently INFERS time coverage from event
   timestamps (conservative: quiet tails look like gaps = pause). Exact
   block-range coverage would remove false COLLECTION_SCAN_INCOMPLETE
   pauses and make the completeness claim precise.
2. **`submitPayment` should expose a pre-broadcast transaction identity**
   (or `preparePayment` should return a nonce/tx-id the caller can persist
   BEFORE broadcast). Today the hash is only known after the RPC accepts,
   leaving the crash window in limitation 1. Alternatively document the
   required nonce-safety guarantee (same intent = same tx) as a contract
   invariant on the live adapter — the fake already models it and the
   tests depend on it.
3. **(minor) `UnresolvedSubmitError` with `txHash = null`** is
   indistinguishable from "never broadcast" for the caller. Consider
   requiring adapters to include the hash whenever the RPC accepted the
   broadcast, and reserving null for "pre-flight/unknown".
4. **(observation, no change needed)** money.ts integer base-unit and
   negative-amount semantics were sufficient for refund adjustments; no
   contracts change was required for the ledger.

## Notes for E (merchant app)

- `db.acceptOffer` is the acceptance entry point: pass the authenticated
  wallet as `expectedMerchantWalletAddress` (identity binding), the client
  `termsHash`, and the authorization evidence from the wallet flow.
- Advance rows expose `pauseReasonCode`/`pausedAt` for accurate paused-state
  display; read-only paths must never trigger jobs (CLI is operator-only).

> > > > > > > codex/float-ledger

---

# HANDOFF — work package D (ledger/worker)

Branch: `codex/float-ledger` (fast-forwarded from main `84e961c` before work
started; nothing else on the branch). Owner of `packages/db/`,
`apps/worker/`, `tests/integration/`. No files outside the owned paths were
modified except this handoff section.

## What was delivered

### packages/db (typed, transactional repositories — no adapter calls here)

- `src/advances.ts` — `acceptOffer`: one transaction binding offer to
  advance to a single funding intent. Idempotency arbiter = new unique
  index `advances_offer_once`; duplicate acceptance returns the existing
  row (`replayed`), mismatched terms hash / wrong merchant identity reject
  with no mutation; second open advance for a merchant rejects
  ADVANCE_ALREADY_OPEN via `advances_one_open_per_merchant`. Plus
  `setAdvanceState` (STATE_TRANSITIONS-checked, stores accurate
  `pause_reason_code`) and `markRepaidIfSettled` (payoff stop incl.
  paused to active to repaid).
- `src/reservations.ts` — `reserveForCollection`: ONE transaction under
  `pg_advisory_xact_lock(hashtext(advanceId))`; rejects non-active advance
  / inactive budget; returns the EXISTING intent for a duplicate stable
  idempotency key (`collection:v1:{advanceId}:{budgetId}`); blocks new
  collection while an intent is submitted/unresolved; caps the payment by
  BOTH remainders (budget remainder = budget.remaining minus held
  reservations on that budget; outstanding remainder = confirmed
  outstanding minus all held reservations) then inserts intent (prepared) +
  reservation (held) BEFORE any broadcast. Zero cap = no intent.
- `src/payments.ts` — `markIntentSubmitting` / `markIntentBroadcast`
  (tx identity persisted pre/post broadcast) / `markIntentUnresolved`
  (timeout = unresolved, reservation KEPT, hash persisted when known) /
  `markIntentFailed` (definitive decoded rejection = reservation released,
  funding failure = funding_failed) / `reconcileIntent` (alias
  `confirmPayment`): ledger effect applied EXACTLY ONCE per
  (advance, kind, txHash) via partial unique index `ledger_entries_tx_once`;
  confirmed funding = disbursement row + funding_pending to active + period
  anchor = funding confirmation time; confirmed collection = repayment row
  (negative amount) + outstanding decrement + budget debit + reservation
  settled + repaid at zero; duplicate reconciles repair bookkeeping only.
  No exactly-once claim across db+chain: reconcile-once semantics,
  documented.
- `src/budgets.ts` — `createBudgetForPeriod` implementing the frozen PLAN
  section 3 formula budget[p] = min(floor(rate_bps * max(0, receipts[p-1])
  / 10000), ceiling, outstanding_at_creation), idempotent per
  (advance, periodStart) via new unique index; zero-eligible = budget
  frozen at 0, status exhausted. `supersedeExpiredBudgets` (unused expired
  budgets never accumulate).
- `src/ingestion.ts` — cursor row per (chainId, token); `upsertReceiptEvents`
  idempotent on (chainId, txHash, logIndex); conservative coverage tracked
  in `ingestion_cursors.coverage_start_sec/_end_sec` (new columns);
  `loadEventsForMerchant` for snapshot building (receipts + normalized
  refunds).
- `src/snapshots.ts` — `persistSnapshot`: ONLY complete snapshots are
  frozen, insert-once per (merchant, windowStart) via new unique index
  (first freeze wins; incomplete windows stay unfrozen so a gap-free
  rebuild can freeze them); per-event classification rows persisted
  separately from raw events; `assertOutstandingMatchesLedger` invariant
  helper.
- `src/offers.ts`, `src/authorizations.ts`, `src/errors.ts` (LedgerError
  with stable reason codes), `src/ids.ts` (stable idempotency keys),
  `src/tx.ts` (advisory-lock helpers).
- NEW migration `drizzle/0001_tranquil_earthquake.sql` (applied): pause
  reason columns, coverage columns, `advances_offer_once`,
  `collection_budgets_advance_period_once`,
  `revenue_snapshots_merchant_window_once`. The 0000 migration is untouched.

### apps/worker (one persistent loop, jobs as importable functions)

- `src/pipeline.ts` — the classification integration point: the worker
  depends on an injectable `ReceiptPipeline` seam; default impl wraps
  policy v1 (`classifyEvents` + `buildRevenueSnapshots`). When the adapter
  is a fake, `createWorkerContext` FORCES `evidenceMode: synthetic_fixture`
  (a fake can never generate live-looking evidence).
- Jobs (structured results; per-tick failures logged, loop survives):
  `ingestReceipts` (two passes over one cursor: recipients=[merchant] and
  senders=[merchant], the refund pass the adapter normalizes to
  negative-amount events; cursor + conservative coverage; inconsistent
  cursors truncate coverage), `createBudgets` (snapshots for completed
  post-funding windows, then a budget for every period whose receipts
  window completed with a COMPLETE snapshot, incl. the current period),
  `reconcileUnresolved` (reconciles every intent with unknown outcome +
  known txHash; NEVER blind-retries with a new economic payment),
  `fundAdvances` (requires db-confirmed + chain-valid authorization before
  disbursement), `runCollections` (allowance, chain clamp: remaining period
  allowance + spendable balance, reserve, broadcast, reconcile),
  `pauseOnBlocked` (accurate reasons: COLLECTION_UNRESOLVED_PAYMENT /
  _REVOKED / _EXPIRED / _NOT_VALID / COLLECTION_SCAN_INCOMPLETE /
  COLLECTION_WALLET_INSUFFICIENT_BALANCE; resumes when the blocker clears).
- `src/main.ts` — operator-only CLI: `pnpm --filter @float/worker start --
[--once | --job=NAME | --interval-ms=N]`; manual triggers are CLI-only,
  never exposed via read-only paths. Live adapter comes from packages/chain
  and currently fails with B's explicit not-implemented guard.

### tests/integration (vitest + real Postgres)

- Per-test-file SCHEMA harness (`test/testdb.ts`): applies the frozen
  migration SQL with the `"public".` FK qualifiers rewritten to the file's
  schema (drizzle-kit qualifies FKs to public); vitest may run files in
  parallel safely; suites auto-skip when Postgres is unreachable (CI-safe).
- `fakes/fakeTempoAdapter.ts` — `implementation: "fake" as const` (asserted
  in every harness); scripted submit outcomes: success, timeout AFTER
  broadcast (UnresolvedSubmitError WITH txHash), timeout BEFORE broadcast
  (no hash), definitive protocol failure (FakeProtocolError, decoded
  reason); deterministic nonce-safe re-submission (same intent key = same
  txHash); refund-pass normalization to negative-amount events; per-key
  authorization reads; injectable clock.
- `fakes/stubPipeline.ts` — stub classifier for the classification
  integration-point tests (exclusion rules independent of policy v1).

## Commands run and results

- `pnpm install` — exit 0 (lockfile updated for workspace dep additions).
- `pnpm db:generate` + `pnpm db:migrate` — migration 0001 applied to
  postgres:16 @ localhost:54329.
- `pnpm typecheck` (workspace, 9 projects) — exit 0.
- `pnpm test` (workspace) — exit 0: contracts 4, policy 116, e2e 1,
  tests/integration 11 files / 29 tests; db/worker/chain passWithNoTests.
- `pnpm --filter @float/tests-integration test` detail: 11 files, 29 tests,
  all passed (G3 scenarios below).
- `pnpm exec prettier --check` on all owned sources — clean. NOTE:
  `pnpm format:check` at repo root reports pre-existing warnings for ~87
  files on Windows because this checkout has CRLF (OneDrive); untouched
  files are equally affected and CI (LF checkout) is green — pre-existing
  platform artifact, not introduced here.
- `pnpm --filter @float/worker start -- --help` — prints usage; `--job=...`
  without a live adapter fails with the explicit B/G1 guard message.

## G3/G4 matrix (PLAN section 7) — scenario, test, result

| Scenario                                   | Test (tests/integration/test/)                                    | Result                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate acceptance/funding               | g3-duplicate-acceptance-funding.test.ts                           | PASS — replay returns same advance; one funding intent; one disbursement ledger row; duplicate reconcile = already-applied                                                                    |
| Duplicate jobs/concurrent triggers         | g3-concurrent-triggers.test.ts                                    | PASS — 2 concurrent runCollections / reserveForCollection / createBudgets = exactly one intent+reservation+repayment, one budget per period; over-collection request clamped to cap           |
| Crash around broadcast / lost RPC response | g3-crash-before-ack.test.ts                                       | PASS — crash after txHash persistence: fresh run reconciles SAME tx once; rerun no-op; UnresolvedSubmitError keeps reservation, later reconcile applies once, no replacement broadcast        |
| Unresolved across period rollover          | g3-unresolved-rollover.test.ts                                    | PASS — reservation held across rollover; new period collection blocked (UNRESOLVED_BLOCK); health pauses with COLLECTION_UNRESOLVED_PAYMENT; reconcile settles + resumes; new period collects |
| Zero receipts                              | g3-zero-receipts.test.ts                                          | PASS — complete coverage + zero eligible = budgets frozen at 0 (exhausted), ZERO_ELIGIBLE_RECEIPTS skip, no intent/tx, no pause                                                               |
| Incomplete history/scan gap                | g3-pause-reasons.test.ts                                          | PASS — no coverage = COLLECTION_SCAN_INCOMPLETE pause; backfill = resume                                                                                                                      |
| Refund/self-transfer/Float disbursement    | g3-classification-exclusions.test.ts (stub classifier)            | PASS — net = sale minus refund adjustment; exclusions contribute 0; budget/repayment follow net                                                                                               |
| Remaining debt below normal payment        | g3-final-payment.test.ts                                          | PASS — budget capped by outstanding (10 < 20); exact final partial; advance repaid; no post-payoff collection                                                                                 |
| Insufficient balance/revoked/expired key   | g3-pause-reasons.test.ts                                          | PASS — COLLECTION_WALLET_INSUFFICIENT_BALANCE / _REVOKED / _EXPIRED with accurate codes; resume when cleared; no authorization = never funded                                                 |
| Duplicate event/receipt ingestion          | g3-classification-exclusions.test.ts                              | PASS — same range ingested 3x = 0 new rows after first; one frozen snapshot; one budget; one repayment                                                                                        |
| Auth/offer replay or another merchant's ID | g3-offer-replay.test.ts + g3-duplicate-acceptance-funding.test.ts | PASS — expired/declined/wrong-identity/wrong-hash rejected with zero financial rows; replay returns same advance                                                                              |

Plus `funding-activation.test.ts`: funding_pending to active ONLY on
reconciled confirmed funding (submitted/unresolved never activate; anchor =
funding confirmation; protocol failure = funding_failed and the slot frees).

## Limitations (read before building on this)

1. **Crash window between broadcast and txHash persistence.** If the
   process dies between `submitPayment` and `markIntentBroadcast`, the
   intent is `submitted` with `txHash = null` and cannot be reconciled by
   hash. The code never blind-retries; such intents are surfaced for
   operators. The fake models the mitigation (deterministic nonce = same
   txHash per intent key) but the live adapter must actually provide it.
2. **Conservative coverage.** The frozen `ingestTransfers` returns only
   events + cursor, so time coverage is inferred from observed event
   timestamps: a quiet tail after the last sale leaves later windows
   incomplete = pause (never stale reuse). Coverage START is pinned to the
   funding anchor. See contracts-change request 1 for the exact fix.
3. **First freeze wins.** A complete snapshot is frozen once per window;
   late-arriving NEW sales for an already-frozen window are dropped
   (documented demo simplification). Refunds are append-only adjustments
   applied by the pipeline to a later unprocessed window (policy v1
   semantics), so settled budgets are never rewritten.
4. **submitted-without-hash recovery** relies on the adapter's nonce-safe
   re-submission for funding only; collections in that state wait for
   operator review rather than risk a double collect.
5. Tests use accelerated 3600 s simulated periods with an injected clock —
   explicitly NOT evidence of a 24-hour chain rollover (PLAN section 3).
6. Budget recomputation re-classifies the merchant's events each tick
   (deterministic, self-consistent; O(n) per tick — fine for demo scale).

## Contracts-change requests (integrator/A to decide; nothing changed by D)

1. **`TempoAdapter.ingestTransfers` should return scanned coverage** — e.g.
   `nextCursor` plus `scanned: { fromBlock, toBlock, blockTimeSec? }[]` or a
   head timestamp. The ledger currently INFERS time coverage from event
   timestamps (conservative: quiet tails look like gaps = pause). Exact
   block-range coverage would remove false COLLECTION_SCAN_INCOMPLETE
   pauses and make the completeness claim precise.
2. **`submitPayment` should expose a pre-broadcast transaction identity**
   (or `preparePayment` should return a nonce/tx-id the caller can persist
   BEFORE broadcast). Today the hash is only known after the RPC accepts,
   leaving the crash window in limitation 1. Alternatively document the
   required nonce-safety guarantee (same intent = same tx) as a contract
   invariant on the live adapter — the fake already models it and the
   tests depend on it.
3. **(minor) `UnresolvedSubmitError` with `txHash = null`** is
   indistinguishable from "never broadcast" for the caller. Consider
   requiring adapters to include the hash whenever the RPC accepted the
   broadcast, and reserving null for "pre-flight/unknown".
4. **(observation, no change needed)** money.ts integer base-unit and
   negative-amount semantics were sufficient for refund adjustments; no
   contracts change was required for the ledger.

## Notes for E (merchant app)

- `db.acceptOffer` is the acceptance entry point: pass the authenticated
  wallet as `expectedMerchantWalletAddress` (identity binding), the client
  `termsHash`, and the authorization evidence from the wallet flow.
- Advance rows expose `pauseReasonCode`/`pausedAt` for accurate paused-state
  display; read-only paths must never trigger jobs (CLI is operator-only).
