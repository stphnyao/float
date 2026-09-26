# Fixtures

Deterministic, labeled merchant histories and expected results. Owned by work
package C. Rules (PLAN.md sections 2 and 4):

- Every fixture carries an evidence label (`synthetic_fixture`) in the fixture
  file itself, in every score computed from it, and on every dashboard render.
- Fixtures are deterministic: same input, same classification, same offer.
- Include the demo profiles (eligible, suspicious, insufficient history) with
  ~30 simulated days where useful, plus the edge-case suite (concentrated
  legitimate revenue, volatility, self-funding, refunds, incomplete history,
  inactivity) kept separate from demo fixtures.
- Never silently combine synthetic and observed totals.

## Layout

- `types.ts` — fixture types (type-only imports of the frozen contracts DTOs).
- `helpers.ts` — integer-only builders: address book, `EventFactory`
  (deterministic tx hashes/timestamps), daily-total splitter, full-coverage
  helper. No runtime dependencies.
- `demo/` — the three demo profiles:
  - `demo_eligible` — 30 simulated days, 5 payers, 2 zero-sales days ->
    eligible, sized under policy-v1 defaults (principal 427,000,000 base
    units at 6 decimals).
  - `demo_suspicious` — circular cashbacks, faucet inflow, self-transfer,
    known self-funding -> declined (`policy_suspicious_flow_detected`).
  - `demo_insufficient` — 6 active days in a 30-day span ->
    insufficient_evidence (`policy_insufficient_history_active_periods`).
- `edge/` — evaluation cases kept separate from the demo fixtures:
  - `edge_concentrated` — legitimate but 85% single-payer -> declined
    (concentration cap).
  - `edge_volatility` — one 20,000-unit spike day -> declined (volatility
    bound).
  - `edge_self_funding` — all inflows from a declared merchant-controlled
    address -> insufficient_evidence, zero eligible receipts.
  - `edge_refunds` — refunds in settled windows are applied append-only to
    the first later unprocessed window; settled windows unchanged -> eligible.
  - `edge_refund_deferred` — refund with no later unprocessed window is
    carried forward as a deferred adjustment -> eligible, nothing rewritten.
  - `edge_incomplete_history` — 3-day scan-coverage gap ->
    insufficient_evidence (`policy_history_incomplete`).
  - `edge_inactivity` — 10 active days then 20 zero days -> insufficient
    evidence; the conservative baseline collapses to 0 because zero-sales
    days are included.

Every fixture embeds `expected`: classification counts per reason code,
decision + reason codes, metrics (complete/active windows, eligible volume,
top-payer share, volatility, baseline), and sizing where the decision is
eligible. Expected values are frozen literals (computed once from
docs/policy-v1.md formulas), asserted by `packages/policy/tests`.

## Importing fixtures

Fixtures are plain TypeScript with **type-only** imports from
`packages/contracts`, so the directory stays runtime-dependency-free and can
be consumed by `packages/policy` tests (and any other workspace package)
without a workspace-package entry:

```ts
import { ALL_FIXTURE_BUILDERS } from "../../../fixtures/index.js";
```

If another package needs fixtures as a dependency later, promote this
directory to a workspace package (`@float/fixtures`) — that requires adding
`fixtures` to the pnpm-workspace globs, which is integrator-owned (recorded
in HANDOFF.md).
