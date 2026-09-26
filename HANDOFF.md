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
