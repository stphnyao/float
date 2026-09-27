# Tempo integration evidence

Updated September 26, 2026. Replaces the previous NOT VERIFIED revision entirely.

## Verdict: G1 SPIKE EVIDENCE OBTAINED — executable TypeScript spike run against Tempo Moderato testnet with confirmed transactions

The replacement spike described below was implemented and executed. Funded steps
ran against the real Moderato testnet (chain ID 42431) with confirmed receipts.
Evidence mode is labeled per case below; JSON artifacts live in
[spike/evidence/](evidence/) and were produced by the commands shown. **The
wallet-authorization rehearsal used programmatic dev wallets, NOT a browser
wallet** — the actual wallet UX rehearsal remains for G4 with the user's
wallet, as required.

## Run manifest

- UTC timestamp: 2026-09-26, 20:52Z–21:22Z (evidence files carry exact stamps).
- Git commit: this revision of `codex/float-chain` (hash recorded in the
  commit message; every evidence JSON was written before commit).
- Commands (run from `spike/`): `pnpm exec tsx ts/run.ts verify-network`,
  `fund`, `authorize`, `ceiling`, `scopes`, `expiry-revoke`, `reset`, `fees`,
  `ingest`.
- Runtime: Node v20.19.4, pnpm 10.18.2, Windows/win32; **viem pinned
  2.56.9** (locked in `spike/package.json` and `packages/chain/package.json`;
  resolves ox 0.14.45). Chain node reported itself as
  `tempo/v1.15.0-464e519` via `web3_clientVersion`.
- Verified network facts (docs fetched 2026-09-26 from
  https://tempo.xyz/developers/docs/quickstart/connection-details and
  cross-checked against the live RPC and viem's `tempoModerato` chain
  definition):
  - Chain ID **42431** (`eth_chainId` → `0xa5bf`, verified live before every
    write; unexpected chains are rejected).
  - RPC `https://rpc.moderato.tempo.xyz`; WebSocket `wss://rpc.moderato.tempo.xyz`.
  - Explorer `https://explore.testnet.tempo.xyz` (tx URL pattern `/tx/<hash>`).
  - Faucet `https://tempo.xyz/developers/api/faucet`: **programmatic public
    POST `{"address":"<lowercase address>"}` — NO Discord/GitHub/login**,
    mints 1M of each test token per request; 8 mint receipts captured.
  - Test tokens (TIP-20, decimals **6 verified on-chain**, never assumed):
    pathUSD `0x20c0...0000` (symbol `pathUSD`), AlphaUSD `0x20c0...0001`
    (on-chain symbol **`alphaUSD`** — docs label it "AlphaUSD"), BetaUSD
    `0x20c0...0002`, ThetaUSD `0x20c0...0003`.
  - Fee model: **no native gas token**. Fees are paid in a TIP-20 fee token;
    receipts expose `feePayer` and `feeToken`; tx type `0x76` (Tempo).
- Public identifiers used (dev wallets generated at runtime; private keys only
  ever in gitignored `spike/.state/`, never committed or logged):
  - Merchant root: `0xe87288E1C77EF3acc77530993206069703fc9b70`
  - Treasury (sole allowed recipient): `0xc197057273DccE7629ca33488f6F65bC105031F7`
  - Access keys (on-chain key ids): A `0x470f4cdd...` see below, B/C/D likewise.

## Run results

| Case                                                              | Status                                                            | Evidence mode                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| Network/token and dependencies verified                           | **PASS**                                                          | RPC reads + on-chain metadata (no writes)           |
| Actual wallet authorization (delegated access key)                | **PASS (programmatic dev wallets; browser-wallet UX NOT proven)** | confirmed testnet transaction                       |
| Treasury funding confirmed                                        | **PASS**                                                          | confirmed testnet transaction                       |
| Delegated transfer confirmed                                      | **PASS**                                                          | confirmed testnet transaction                       |
| Cumulative spending ceiling (20 units: 15 OK / 6 rejected / 5 OK) | **PASS**                                                          | confirmed testnet transaction + preflight rejection |
| Wrong token/function/recipient                                    | **PASS**                                                          | preflight rejections, no token movement             |
| Expiry rejection                                                  | **PASS**                                                          | preflight rejection after on-chain expiry           |
| Revocation rejection                                              | **PASS**                                                          | confirmed revoke tx + preflight rejection           |
| Period rollover (short period)                                    | **PASS (60s period observed; 24h NOT observed)**                  | confirmed testnet transaction                       |
| Fee behavior                                                      | **PASS**                                                          | confirmed testnet transaction + probes              |

### Details and evidence

**a. Network/token/dependencies** (`evidence/01-verify-network.json`):
chainId 42431 verified over RPC before any write; all four faucet tokens read
via `token.getMetadata` (name/symbol/decimals 6/currency USD/totalSupply).

**b. Authorization** (`evidence/03-authorize.json`): merchant root authorized
four dedicated P256 access keys via `accessKey.authorizeSync`
(accountKeychain `authorizeKey`), each with scope exactly
`transfer(0x20c0...0001)` restricted to recipients `[treasury]` and expiry in
the future. Authorization txs (all success):
A `0x550003821ab44de465dda0ea4bb8957cf9c68fb1c91eedc033cba325c5549044`,
B `0x3f879426d32dfec2cf555e790b695ebe4f556a302b5db8313d5891221e81b996`,
C `0xa3e75185b1e0ad6a0a82e3b1c2f27945a0889afb68854979643e654070f9e8ff`,
D `0x78fcd08f8817bd4026ab766234abfb6b84cbf4dc05cb85665e7dd042d0be3809`.
Key ids: A `0x470f4cdff6f7bf4a63aac5123315ded6d5690508`,
B `0x6a7005704345afd8646250ae9af34d3dc0bfffaf`,
C `0x946af5334efcd33d76aea3e814e214d3f229cb96`,
D `0x461e17427546aacef4bec528e2f06d39ea11b059`.
On-chain reads after authorization: `spendPolicy=limited`, `isRevoked=false`,
remaining = full limit, and **periodEnd = authorization_time + period**
(A: 1790542840 = auth+86400; B: auth+60), confirming TIP-1011 anchoring.
Each key carries TWO limits (see Fee behavior): AlphaUSD 20/20/5/5 units with
period 86400/60/none/none, plus pathUSD 1 unit (fee allowance).
**Wallet caveat: these are programmatic dev wallets. A local root-key fixture
does not prove browser-wallet UX; that rehearsal is G4 with the user's wallet.**

**c. Treasury funding** (`evidence/02-fund.json`): faucet → merchant and
faucet → treasury, 8 mint txs awaited to success (e.g. merchant AlphaUSD mint
`0x9231e78ebfe378e9d016dbc3db10ea2434a4663d7c694028f8932eadb211dd1e`);
balances recorded before/after. Merchant → treasury funding-back via the
delegated key is the ceiling/reset evidence below.

**d. Cumulative ceiling** (`evidence/04-ceiling.json`), key A (20-unit /
86400s), merchant balance ≥ 26 units so only the cap could reject:

1. 15 units **confirmed** `0xd57832f27725d8e6be346e5c1e46a358b96e727c1cad9998a599dece5a975d9e`
   → remaining exactly 20,000,000 → 5,000,000 (periodEnd unchanged 1790542840).
2. 6 units **rejected**: classification
   `estimation_preflight_rejection_no_receipt` — failed in `eth_estimateGas`
   with **no receipt and no tx hash**; raw revert data `0x8a9e71ea` =
   selector of `SpendingLimitExceeded()` (TIP-1011's named error; the reason
   text "Account keychain error: SpendingLimitExceeded(SpendingLimitExceeded)"
   was also captured). Balances unchanged.
3. 5 units **confirmed** `0x2ee0dbfaad70728f958b54d04609d20d0a34427a3c4bc40b3870fdd58a8a952d`
   → remaining exactly 0.
   A prior interrupted run consumed 15 units; remaining was restored with
   `accessKey.updateSpendingLimit` (sets limit AND remaining, period untouched):
   `0xf472f0d3cd665cacc57a5ba2b6a7604ad250001234c20414e7cf3c66de6f6fd5`
   (`evidence/04a-limit-reset.json`).

**e. Scopes** (`evidence/05-scopes.json`), key D (remaining 5 units): wrong
recipient, wrong token (BetaUSD), wrong selector (`approve`) each rejected as
`estimation_preflight_rejection_no_receipt` with raw revert data `0x576b38b4`
= `CallNotAllowed()`; token balances before == after (no token moved).

**f. Expiry and revocation** (`evidence/06-expiry-revoke.json`) as independent
tests on separate keys: post-expiry transfer via key C (on-chain expiry 1790456590) rejected preflight with `KeyExpired(KeyExpired)`; key D revoked
on-chain (`accessKey.revoke` → success
`0x7080ae2d34b71bb215116a295ee220e7a935bdf73ee2bb5caf71dd1543d41f75`,
`getMetadata.isRevoked=true`), then a transfer via key D rejected preflight
with `KeyAlreadyRevoked(KeyAlreadyRevoked)`. (TIP-1053 witness burn applies to
unused signed authorizations and was not exercised — our keys are authorized
on-chain, so `revokeKey` is the correct invalidation.)

**g. Period rollover** (`evidence/07-reset.json`), key B (20 units / **60s**):
12 units confirmed `0x9df55f772f021d52cd323fe85d9bd7ba822ae3691ff48a385d9b470499b73680`
→ remaining 8,000,000; after waiting past the on-chain periodEnd (1790456981,
+10s buffer), remaining read **20,000,000 with periodEnd advanced exactly +60s**
(1790457041); second 12-unit transfer confirmed
`0x4c47ff83eff564ed5cf11d779f54b7e9e76775d9bb8dde17b7e9d91ff6530340` →
remaining 8,000,000 again. **ACTUAL PERIOD OBSERVED: 60 seconds. The 86400s
configuration is verified by on-chain reads on key A (accepted + anchored), but
a full 24-hour rollover was NOT observed** and must not be claimed.

**h. Fee behavior** (`evidence/08-fees.json`, `evidence/08a-fee-probes.json`):

- Fee token on receipts: pathUSD `0x20c0...0000` (client-configurable);
  feePayer = sender (merchant root) by default; tx type `0x76`.
- Direct root transfer probe `0x1a962593b1254762675b6ef29098c11a2ff780fb06dbe3876e7e0ea6feff91e9`:
  gasUsed 39,918 × effectiveGasPrice 10.225 gwei → 409 pathUSD base units
  charged to the merchant's pathUSD balance; AlphaUSD moved exactly 1 base unit.
- **Critical discovered behavior (probes)**: with `enforceLimits=true`, fee
  payment is itself limit-enforced. A key whose limit set lacks the fee token
  fails EVERY spend with `SpendingLimitExceeded` (preflight, observed). When
  the fee token equals the limit token, fees count against that limit
  (observed: remaining dropped 20,000,000 → 19,999,439 for a 1-base-unit
  transfer = 1 amount + 560 fee; tx `0x6a8476edcb89e4510c023352d743a2ff0ec8614bb71a6adb9423f93af994dda6`).
- Consequence adopted: keys are authorized with BOTH limits at authorization
  time (collection token recurring ceiling + pathUSD fee allowance), so
  ceiling accounting is exact (15+5 = 20 consumed, fees never touched it).
  `updateSpendingLimit` can add a new token limit but only with period 0
  (lifetime) — recurring fee allowances must be configured at authorization.
- Funding documented: merchant root needs fee-token (pathUSD) balance for
  its own txs plus each key needs the collection token balance to spend;
  faucet supplies 1M of each token per request.

**i. Adapter path (packages/chain)** (`evidence/09-ingest.json`): the typed
live adapter `createTempoAdapter` (viem 2.56.9) verified network, token
metadata, balances, and re-read **9 confirmed TIP-20 Transfer events** to the
treasury (including the delegated ceiling/reset transfers above) with
recipient filtering, gap-free cursor paging (MAX_INGEST_BLOCKS), block
timestamps, and **0 duplicates across the cursor boundary on replay**.

## Honest limitations

1. **Browser-wallet UX is not proven.** All authorizations were signed by
   programmatic dev wallets inside the spike process. G4 must rehearse with
   the user's actual wallet.
2. **24-hour period rollover was not observed** (would take 24h); the 86400s
   configuration was verified accepted and anchored on-chain only.
3. All observed protocol rejections were **preflight/estimation rejections
   without receipts**. A submitted-then-reverted receipt (post-inclusion
   failure) was never observed on testnet, so the adapter's reverted-receipt
   decoding path is implemented but unproven; the same holds for the
   live-timeout `UnresolvedSubmitError` path (implemented per the frozen
   contract, unit-tested against a fake, not observed live).
4. Wallets, keys, and state live in `spike/.state/` (gitignored); this spike
   does not establish key-management practice for any real deployment.
5. `getRemainingLimit`/`getMetadata` cannot distinguish an unauthorized key id
   from certain degenerate configurations (the keychain returns a default
   entry); the adapter treats the observed default as `invalid`.

## Previous revision (2026-09-26, earlier)

The earlier text asserted unverifiable SDK/faucet successes and was retracted;
see Git history. The legacy Python sketch (`pull_test.py`) remains historical
context only and must not be run.
