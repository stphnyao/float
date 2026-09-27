import { PRIMARY_TOKEN, TOKENS, FEE_TOKEN, makeClient } from "../config.js";
import {
  jsonSafe,
  log,
  recordEvidence,
  snapshotBalances,
  loadState,
  saveState,
  explorerLink,
  assertChainId,
} from "../util.js";
import { newRootAccount } from "../config.js";
import type { Address } from "viem";
/**
 * Generates throwaway dev wallets (random keys, never committed/logged),
 * funds the merchant root via the programmatic testnet faucet, waits for
 * the mint receipts, and records before/after balances.
 *
 * G1 matrix item (c) part 1: faucet -> merchant funding with confirmed receipt.
 */
export async function fund(): Promise<void> {
  const client = makeClient();
  await assertChainId(client, "fund");

  let state;
  let addresses: { merchant: Address; treasury: Address };
  try {
    state = loadState();
    addresses = {
      merchant: state.merchant.address,
      treasury: state.treasury.address,
    };
    log(
      "fund",
      "reusing existing dev wallets from state (addresses only re-used; keys stay in .state, gitignored)",
    );
  } catch {
    const merchant = newRootAccount();
    const treasury = newRootAccount();
    state = {
      createdAt: new Date().toISOString(),
      merchant: {
        address: merchant.account.address,
        privateKey: merchant.privateKey,
      },
      treasury: {
        address: treasury.account.address,
        privateKey: treasury.privateKey,
      },
      keys: {},
      receipts: {},
    };
    addresses = {
      merchant: merchant.account.address,
      treasury: treasury.account.address,
    };
    saveState(state);
    log(
      "fund",
      "generated fresh dev wallets (private keys saved to gitignored .state only)",
    );
  }

  log("fund", "merchant address:", addresses.merchant);
  log("fund", "treasury address:", addresses.treasury);

  const tokens = [
    { label: "pathUSD", address: TOKENS.pathUSD },
    { label: "AlphaUSD", address: TOKENS.AlphaUSD },
  ];
  const before = await snapshotBalances(
    client,
    [
      { label: "merchant", address: addresses.merchant },
      { label: "treasury", address: addresses.treasury },
    ],
    tokens,
  );
  log("fund", "balances before faucet:", before);

  // Programmatic faucet: no auth required (docs/quickstart/faucet).
  const faucetResponses: Record<string, unknown> = {};
  for (const [label, address] of Object.entries({
    merchant: addresses.merchant,
    treasury: addresses.treasury,
  })) {
    const res = await fetch("https://tempo.xyz/developers/api/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: address.toLowerCase() }),
    });
    const body = (await res.json()) as {
      data?: { hash: string }[];
      error?: string | null;
    };
    faucetResponses[label] = { status: res.status, ...body };
    log("fund", `faucet ${label}: HTTP ${res.status}`, body);
    if (!res.ok || !body.data?.length) {
      throw new Error(
        `faucet request failed for ${label}: HTTP ${res.status} ${JSON.stringify(body)}`,
      );
    }
    for (const mint of body.data) {
      const receipt = await client.waitForTransactionReceipt({
        hash: mint.hash as `0x${string}`,
        retryCount: 8,
      });
      log(
        "fund",
        `mint receipt ${label} ${mint.hash.slice(0, 14)}... status=${receipt.status} block=${receipt.blockNumber} feeToken=${receipt.feeToken ?? "?"} feePayer=${receipt.feePayer ?? "?"}`,
      );
      state.receipts[`faucet-${label}-${mint.hash.slice(0, 10)}`] = mint.hash;
    }
  }
  saveState(state);

  const after = await snapshotBalances(
    client,
    [
      { label: "merchant", address: addresses.merchant },
      { label: "treasury", address: addresses.treasury },
    ],
    tokens,
  );
  log("fund", "balances after faucet:", after);

  const evidence = {
    step: "fund",
    mode: "confirmed testnet transaction",
    faucetUrl: "https://tempo.xyz/developers/api/faucet",
    faucetAuth: "none (public POST; no Discord/GitHub login)",
    merchantAddress: addresses.merchant,
    treasuryAddress: addresses.treasury,
    beforeBalancesBaseUnits: before,
    afterBalancesBaseUnits: after,
    mintTxHashes: Object.entries(faucetResponses).flatMap(([label, r]) =>
      ((r as { data?: { hash: string }[] }).data ?? []).map((d) => ({
        to: label,
        hash: d.hash,
        explorer: explorerLink(d.hash),
      })),
    ),
    primaryToken: { label: "AlphaUSD", address: PRIMARY_TOKEN },
    feeTokenDefault: FEE_TOKEN,
    notes:
      "Faucet mints 1M of each of pathUSD/AlphaUSD/BetaUSD/ThetaUSD per request. Receipts awaited for each mint.",
  };
  console.log(JSON.stringify(jsonSafe(evidence), null, 2));
  recordEvidence("02-fund", evidence);
  log("fund", "OK");
}

if (process.argv[1]?.includes("fund")) {
  fund().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
