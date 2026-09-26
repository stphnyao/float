# Access-Key Cap-Enforcement Spike

Date: 26 Sep 2026

## Goal
Demonstrate that **Tempo** test-net enforces the *daily spend cap* baked into an **access-key**:
1. A pull ≤ cap succeeds  
2. A pull > cap fails on-chain (revert)

## Environment
- Tempo RPC: `https://rpc.test.tempo.xyz`
- Python `pytempo` version: *NOT YET AVAILABLE* – attempted install from `main` branch 76c3c4b but the `AccessKey` API is missing.
- Fallback TypeScript SDK: version `0.8.1-beta` (**works**, see `yarn.lock` in scratch dir) – but running TS in this Python-only Cloud Agent is out-of-scope; will integrate later if required.

`.env` variables used (see `.env.example`). **Never commit the real file.**

## Attempts & Findings
| Step | Result | Tx | Explorer |
|------|--------|----|----------|
| Fund merchant wallet via faucet | **PASS** | 0x799c… | <https://explorer.test.tempo.xyz/tx/0x799c…> |
| Create access-key (cap = 20) | **FAIL** – SDK lacks `create_access_key` | – | – |
| In-cap pull (15) | *N/A* | – | – |
| Over-cap pull (30) | *N/A* | – | – |

The current Python SDK does **not yet expose** the access-key endpoints.  After reading the Tempo Discord (link in PLAN.md) the maintainers confirmed the feature will land “during the hackathon week”; they pointed to the TypeScript SDK which already supports it (`import { AccessKey } from "@tempo/sdk"`).

## Verdict
> **BLOCKED** – cannot complete cap-enforcement test in Python today.  Fallback is to switch to the TypeScript SDK (see PLAN.md §6) or use direct contract calls once the ABI is published.

## Next Actions
1. **Sun Sep 27** – Try again with the TS SDK inside a Node script (`spike/pull_test.ts`).  Record tx hashes once Tempo unblocks.
2. Keep watching `#dev-updates` channel for the Python SDK merge.
