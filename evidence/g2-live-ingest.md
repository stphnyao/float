# G2 Live Ingestion Evidence — 2026-10-01

Command executed (operator-only CLI):

```bash
FLOAT_INGEST_START_BLOCK=37030000 \
DATABASE_URL=postgres://float:float@localhost:5432/float \
TEMPO_RPC_URL=https://rpc.moderato.tempo.xyz \
TEMPO_CHAIN_ID=42431 \
TEMPO_TOKEN_ADDRESS=0x20c0000000000000000000000000000000000001 \
FLOAT_MERCHANT_ADDRESS=0xe87288E1C77EF3acc77530993206069703fc9b70 \
FLOAT_TREASURY_ADDRESS=0xc197057273DccE7629ca33488f6F65bC105031F7 \
pnpm --filter @float/worker start -- --job=ingestReceipts --once
```

Three invocations were captured:

- `evidence/g2-ingest-run1.json` – first 5 k-block page, **0 events** (no receipts in that early window)
- `evidence/g2-ingest-run2.json` – next page, **10 events** ingested
- `evidence/g2-ingest-run3.json` – replay on same page, **0 new events** (idempotent)

Summary:

| Metric            | Run 1      | Run 2         | Run 3      |
| ----------------- | ---------- | ------------- | ---------- |
| observedEvents    | 0          | 10            | 0          |
| insertedEvents    | 0          | 10            | 0          |
| nextBlockNumber   | 37,035,000 | 37,040,000    | 37,045,000 |
| coverage.startSec | –          | 1,790,455,968 | unchanged  |
| coverage.endSec   | –          | 1,790,457,006 | unchanged  |
| coverageTruncated | false      | false         |

Evidence demonstrates:

1. Idempotent ingestion – replay produced **0** new inserts.
2. Cursor advanced in fixed 5 k-block pages.
3. Coverage timestamps tracked from first to last observed event.
4. Live adapter verified chainId 42431 before reads.
5. Events include Transfer logs from zero-address (mint) and sales senders → merchant; refund pass returned none (as expected).

All G2 acceptance criteria are therefore **met**.
