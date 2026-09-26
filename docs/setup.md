# Setup

Last verified: 2026-09-26 (G0). Every command below was run as shown.

## Prerequisites

- Node.js >= 20.19 (verified: v20.19.4)
- pnpm 10.18.2 (`corepack enable` or `npm i -g pnpm@10`)
- Docker Desktop running (for local Postgres; no native Postgres required)

## Bootstrap

```bash
pnpm install                # 119 packages; lockfile is pinned
docker compose up -d postgres   # float-postgres on localhost:54329
pnpm db:migrate             # applies packages/db/drizzle migrations
```

## Verify

```bash
pnpm typecheck              # all 9 workspace projects, exit 0
pnpm test                   # vitest everywhere, exit 0 (fakes only)
```

Database sanity: the `advances_one_open_per_merchant` partial unique index
enforces one OPEN advance (funding_pending/active/paused) per merchant. Verified
2026-09-26 against postgres:16-alpine: a second open advance for the same
merchant fails with `duplicate key value violates unique constraint
"advances_one_open_per_merchant"`, and after the first advance is set to
`repaid` a new `funding_pending` advance inserts successfully.

## Services

- Web (Next.js): `pnpm dev:web` — http://localhost:3000
- Worker: `pnpm dev:worker` — currently a startup stub; package D implements jobs
- Postgres: `docker compose ps` / stop with `pnpm db:down` (drops volume)

## Environment

`DATABASE_URL` defaults to `postgres://float:float@localhost:54329/float`.
Set it explicitly for anything else. Never commit `.env`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs install + typecheck + tests +
format check on every push/PR using fakes only — no Postgres service and no
testnet writes. Funded Tempo testnet runs are explicit manual integration runs
(PLAN.md section 7).

## Conventions

- Money: integer token base units internally (`bigint`), decimal integer
  strings in JSON (`MoneyAmount`). Never floats.
- States: transitions only via `STATE_TRANSITIONS` in `@float/contracts`.
- Evidence: every surface carries `synthetic_fixture` or `observed_testnet`.
