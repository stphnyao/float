import { PRIMARY_TOKEN, TOKENS, makeClient, units } from "../config.js";
import {
  jsonSafe,
  log,
  recordEvidence,
  loadState,
  assertChainId,
  snapshotBalances,
  expectRejection,
  accessKeyAccountFromState,
} from "../util.js";
import { rootFromPrivateKey } from "../config.js";
import type { Address } from "viem";

/**
 * G1 matrix item (e): wrong token, wrong recipient, wrong function selector
 * must all be rejected by the access-key scopes, and no token may move.
 * Runs after the ceiling step, when the 20-unit period allowance is already
 * exhausted — a successful call would additionally prove the cap failed.
 */
export async function scopes(): Promise<void> {
  const client = makeClient();
  await assertChainId(client, "scopes");

  const state = loadState();
  const merchant = rootFromPrivateKey(state.merchant.privateKey);
  const keyA = accessKeyAccountFromState(state, merchant, "A");
  const treasury: Address = state.treasury.address;

  const accounts = [
    { label: "merchant", address: merchant.address },
    { label: "treasury", address: treasury },
  ];
  const tokens = [
    { label: "AlphaUSD", address: PRIMARY_TOKEN },
    { label: "BetaUSD", address: TOKENS.BetaUSD },
  ];
  const balancesBefore = await snapshotBalances(client, accounts, tokens);
  log("scopes", "balances before rejection attempts:", balancesBefore);

  const cases: Record<string, unknown> = {};

  // 1. Wrong recipient: transfer to a non-treasury address.
  const wrongRecipient: Address = "0x00000000000000000000000000000000c0ffee00";
  cases.wrongRecipient = await expectRejection(
    "scopes",
    "wrong recipient transfer",
    () =>
      client.token.transferSync({
        account: keyA,
        token: PRIMARY_TOKEN,
        to: wrongRecipient,
        amount: units(1n),
      }),
  );

  // 2. Wrong token: BetaUSD is not in the key's scope (contract not allowed).
  cases.wrongToken = await expectRejection(
    "scopes",
    "wrong token transfer",
    () =>
      client.token.transferSync({
        account: keyA,
        token: TOKENS.BetaUSD,
        to: treasury,
        amount: units(1n),
      }),
  );

  // 3. Wrong function selector: approve() on the same token is not the
  //    scoped transfer selector. No allowance may be created.
  cases.wrongSelectorApprove = await expectRejection(
    "scopes",
    "wrong selector approve()",
    () =>
      client.token.approveSync({
        account: keyA,
        token: PRIMARY_TOKEN,
        spender: treasury,
        amount: units(1n),
      }),
  );

  const balancesAfter = await snapshotBalances(client, accounts, tokens);
  const unchanged =
    JSON.stringify(balancesBefore) === JSON.stringify(balancesAfter);
  log("scopes", "balances after rejection attempts:", balancesAfter);
  log("scopes", "no token moved:", unchanged);

  const evidence = {
    step: "scopes",
    mode: "confirmed testnet transaction",
    keyLabel: "A",
    scope: `transfer(${PRIMARY_TOKEN}) -> ${treasury} only`,
    cases,
    balancesBefore,
    balancesAfter,
    noTokenMoved: unchanged,
    notes:
      "Each rejection is recorded with honest classification (estimation/preflight vs submitted+reverted). Scopes per TIP-1011: target contract, selector, recipient allowlist.",
  };
  console.log(JSON.stringify(jsonSafe(evidence), null, 2));
  recordEvidence("05-scopes", evidence);
  log("scopes", "OK");
}

if (process.argv[1]?.includes("scopes")) {
  scopes().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
