# Integration tests

Database and lifecycle tests over real Postgres and package boundaries.
Owned by work package D. These run locally against the docker-compose
Postgres; default CI does NOT run them (CI uses fakes only — each suite
auto-skips when Postgres is unreachable). Funded testnet writes are always
an explicit manual integration run, never a test side effect. Requires
`pnpm db:up` and `pnpm db:migrate` first.

## Harness

- **Per-file schemas** (`test/testdb.ts`): every test file gets its own
  Postgres schema created from the frozen drizzle migration SQL (with the
  `"public".` FK qualifiers rewritten to the file's schema), so vitest may
  run files in parallel without truncation races. Schemas are dropped on
  cleanup. Set `DATABASE_URL` to override the default
  `postgres://float:float@localhost:54329/float`.
- **FakeTempoAdapter** (`fakes/fakeTempoAdapter.ts`): the only chain used
  by the tests, `implementation: "fake" as const` (asserted per harness).
  Scripts submit outcomes (success / timeout-after-broadcast with txHash /
  timeout-before-broadcast / protocol failure), deterministic nonce-safe
  re-submission, refund-pass normalization, per-key authorization reads,
  and an injectable clock.
- **Stub classifier** (`fakes/stubPipeline.ts`): proves the worker's
  classification integration point (the `ReceiptPipeline` seam) is
  classifier-independent.
- **Accelerated simulated periods**: 3600 s windows driven by an injected
  clock — a test convenience, explicitly NOT evidence of a 24-hour chain
  rollover (PLAN section 3).

The G3/G4 matrix coverage map lives in [HANDOFF.md](../../HANDOFF.md)
(work package D section).
