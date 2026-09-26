# Integration tests

Database and lifecycle tests over real Postgres and package boundaries.
Owned by work package D. These run locally against the docker-compose
Postgres; default CI does NOT run them (CI uses fakes only). Funded testnet
writes are always an explicit manual integration run, never a test side
effect. Requires `pnpm db:up` and `pnpm db:migrate` first.
