# Tempo integration evidence

Updated September 26, 2026.

## Verdict: NOT VERIFIED

No reproducible testnet integration run has been established in this repository. G1 in [PLAN.md](../PLAN.md) remains NOT STARTED. This is an implementation/evidence gap, not proof that Tempo lacks the required functionality.

The Python sketch in this directory uses hypothetical SDK calls. Its .env.example is legacy context, not validated network/token configuration. Do not install dependencies or supply wallet keys to run the sketch.

## Correction to earlier claims

The previous revision asserted successful faucet funding, an attempted Python SDK revision, a working TypeScript package, and maintainer guidance. It supplied only an abbreviated transaction hash, an absent scratch-directory lockfile, and no source link for the maintainer statements. Those claims cannot be verified from the repository and are not accepted as evidence. The earlier text remains in Git history; it must not be cited as a completed spike.

During local review, isolated mocked execution of the Python control flow showed:

- An unexpected successful over-cap transfer returns normally after printing UNEXPECTED SUCCESS.
- An RPC timeout is printed as Expected failure and also returns normally.
- The missing-SDK fallback raises NameError because the exception variable is no longer bound when the fallback constructor runs.

These observations concern the legacy Python sketch only. No wallet credentials or network transactions were used in that review. No chain capability was tested.

## Replacement spike

Implement an executable TypeScript spike using the documented Viem Tempo integration. Verify current deployed network/token details and pin actual dependency versions. Include the real merchant wallet authorization path, treasury funding, delegated transfers, cumulative limits, scopes, expiry, revocation, reset, and fee behavior described by G1.

Use a merchant-attached delegated signer; do not equate ordinary token transferFrom allowances with access-key authorization. Test the intended permission boundary with sufficient balances so unrelated failures cannot masquerade as cap enforcement.

## Required run manifest

For each run record:

- UTC timestamp, Git commit, exact command, runtime and locked dependency versions.
- Evidence mode: local fake, local chain, RPC simulation, submitted testnet transaction, or confirmed testnet transaction.
- Chain ID, RPC/explorer source, token address/decimals, wallet integration, and actual authorization period/expiry/scopes.
- Public account/key identifiers needed for state checks; never private keys, seed phrases, access tokens, or environment dumps.
- Full transaction hashes and receipts where submitted; relevant before/after balances, outstanding obligation, and remaining limits.
- Exact decoded rejection; state when it occurred during RPC simulation/validation and no receipt exists.
- Expected versus observed result, fee payer/token, and any shortened test period.

## Run results

| Case                                    | Status  | Evidence |
| --------------------------------------- | ------- | -------- |
| Network/token and dependencies verified | NOT RUN | None     |
| Actual merchant wallet authorization    | NOT RUN | None     |
| Treasury funding confirmed              | NOT RUN | None     |
| Delegated transfer confirmed            | NOT RUN | None     |
| Cumulative spending ceiling             | NOT RUN | None     |
| Wrong token/function/recipient          | NOT RUN | None     |
| Expiry and revocation                   | NOT RUN | None     |
| Period rollover                         | NOT RUN | None     |
| Fee behavior                            | NOT RUN | None     |

Replace NOT RUN only with an actual outcome and corresponding evidence. A timeout, placeholder hash, mock result, or unsupported SDK assertion cannot pass a testnet integration case.
