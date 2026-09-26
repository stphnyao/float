# Float

Float is a planned Tempo testnet demo of revenue-linked merchant advances: evaluate eligible stablecoin receipts, fund an advance, and collect repayments within merchant-authorized spending limits.

Float's application determines eligible receipts, collection amounts, and outstanding debt. Tempo access keys enforce configured token spending ceilings and permission scopes. Those keys do not establish genuine sales, enforce a percentage of revenue by themselves, or guarantee repayment.

## Status

Planning stage for Stephen Yao's Crypto World's Fair 2026 submission, Tempo track. There is no runnable application or verified live integration yet. The Python file in spike/ is a legacy hypothetical sketch, not an SDK example to install or run. Earlier funding/SDK claims are unverified; see [spike/RESULTS.md](spike/RESULTS.md).

**G0 foundation is in place (2026-09-26):** pnpm TypeScript workspace with frozen shared contracts (`packages/contracts`), Drizzle/Postgres schema with the one-open-advance invariant verified, minimal web/worker apps, CI config, and documented setup in [docs/setup.md](docs/setup.md). The Tempo integration remains NOT VERIFIED (G1 next); `packages/chain` refuses to construct a live adapter until spike evidence exists.

## Build handoff

Read [PLAN.md](PLAN.md) for the agreed MVP, architecture, repayment policy, acceptance gates, ownership boundaries, and agent work packages. The next implementation session starts with G0 (workspace/shared contracts), then the G1 Tempo integration proof. Agents can develop fixtures and policy logic against the agreed interfaces while integration is being verified.

Planned stack: Next.js/TypeScript, Viem's Tempo integration, Postgres, and one persistent Node worker. Scope: one testnet, one supported test token, one treasury, and one open advance per merchant. Synthetic histories must stay visibly separate from observed testnet activity.

Setup and test commands will be added when the workspace exists and those commands have been run successfully. Do not use the legacy spike's guessed SDK APIs or network configuration as implementation instructions.

See [DISCLOSURE.md](DISCLOSURE.md) for the current disclosure, to be reviewed against actual dependencies and work before submission. The project uses the [MIT license](LICENSE).
