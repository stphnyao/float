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

| Dimension | Threshold | Direction |
|---|---|---|
| History completeness | 0 incomplete windows in the evaluated series; contiguous window starts required | lower is better |
| Complete windows | >= 21 | higher is better |
| Active periods (complete windows with net > 0) | >= 15 | higher is better |
| Eligible volume (sum of max(0, net) over complete windows) | >= 300 whole units (scaled by verified decimals) | higher is better |
| Payer concentration (top payer share of included volume) | <= 6000 bps | lower is better |
| Volatility (max active day / mean active day, bps) | <= 25000 bps | lower is better |
| Suspicious flows (suspected-circular volume) | 0 (any > 0 declines) | lower is better |

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
