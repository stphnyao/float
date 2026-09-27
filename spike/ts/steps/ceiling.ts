import {
  PRIMARY_TOKEN,
  TOKENS,
  PERIOD_CEILING_UNITS,
  units,
  makeClient,
} from "../config.js";
import {
  jsonSafe,
  log,
  recordEvidence,
  loadState,
  saveState,
  explorerLink,
  assertChainId,
  snapshotBalances,
  expectRejection,
  accessKeyAccountFromState,
  KNOWN_ERROR_SELECTORS,
} from "../util.js";
import { rootFromPrivateKey } from "../config.js";
import { toFunctionSelector } from "viem";

/**
 * G1 matrix item (d): cumulative ceiling for the 20-unit/86400s key.
 * Collect 15 (succeeds), then 6 (must be rejected with the decoded protocol
 * error — recorded as estimation/preflight rejection or submitted+reverted),
 * then the remaining 5 (succeeds). Balances are funded so a failure can only
 * be the cap. Remaining-limit state is verified on-chain between transfers.
 * Fees are independently accounted (fee token = pathUSD, separate token).
 */
export async function ceiling(): Promise<void> {
  const client = makeClient();
  await assertChainId(client, "ceiling");

  const state = loadState();
  const merchant = rootFromPrivateKey(state.merchant.privateKey);
  const keyA = accessKeyAccountFromState(state, merchant, "A");
  const treasury = state.treasury.address;

  // 15 + 6 + 5 = 26 units <= 1,000,000 faucet units: a failure cannot be
  // missing funds — only the cap (or scope) can reject these.
  const merchantAlpha = await client.token.getBalance({
    account: merchant.address,
    token: PRIMARY_TOKEN,
  });
  if (merchantAlpha.amount < units(PERIOD_CEILING_UNITS + 6n)) {
    throw new Error(
      `merchant AlphaUSD balance ${merchantAlpha.amount} too low for ceiling test — run fund step`,
    );
  }

  const accounts = [
    { label: "merchant", address: merchant.address },
    { label: "treasury", address: treasury },
  ];
  const tokens = [
    { label: "AlphaUSD", address: PRIMARY_TOKEN },
    { label: "pathUSD", address: TOKENS.pathUSD },
  ];

  const readLimit = async () => {
    const r = await client.accessKey.getRemainingLimit({
      account: merchant.address,
      accessKey: keyA.accessKeyAddress,
      token: PRIMARY_TOKEN,
    });
    log(
      "ceiling",
      `remaining=${r.remaining} periodEnd=${r.periodEnd} (now=${Math.floor(Date.now() / 1000)})`,
    );
    return {
      remaining: r.remaining.toString(10),
      periodEnd: r.periodEnd?.toString(10) ?? null,
    };
  };

  const before = await snapshotBalances(client, accounts, tokens);
  const limitBefore = await readLimit();
  log("ceiling", "balances before:", before);

  const results: Record<string, unknown> = {};

  // --- Phase 1: 15 units (succeeds) ---
  const tx1 = await client.token.transferSync({
    account: keyA,
    token: PRIMARY_TOKEN,
    to: treasury,
    amount: units(15n),
  });
  log(
    "ceiling",
    `15-unit transfer confirmed tx=${tx1.receipt.transactionHash} status=${tx1.receipt.status} feePayer=${tx1.receipt.feePayer} feeToken=${tx1.receipt.feeToken}`,
  );
  const after15 = await snapshotBalances(client, accounts, tokens);
  const limitAfter15 = await readLimit();
  results.transfer15 = {
    txHash: tx1.receipt.transactionHash,
    explorer: explorerLink(tx1.receipt.transactionHash),
    status: tx1.receipt.status,
    feePayer: tx1.receipt.feePayer,
    feeToken: tx1.receipt.feeToken,
    gasUsed: tx1.receipt.gasUsed?.toString(10),
    balancesAfter: after15,
    limitAfter: limitAfter15,
  };
  state.receipts["ceiling-15"] = tx1.receipt.transactionHash;

  // --- Phase 2: 6 units (MUST be rejected — over the remaining 5) ---
  const over = await expectRejection(
    "ceiling",
    "6-unit over-cap transfer",
    () =>
      client.token.transferSync({
        account: keyA,
        token: PRIMARY_TOKEN,
        to: treasury,
        amount: units(6n),
      }),
  );
  log(
    "ceiling",
    "6-unit transfer rejected as expected:",
    over.kind,
    over.errorName,
  );
  const afterReject = await snapshotBalances(client, accounts, tokens);
  const limitAfterReject = await readLimit();
  results.reject6 = {
    expected: "rejected by period ceiling",
    observed: over,
    balancesAfter: afterReject,
    balancesUnchanged: JSON.stringify(afterReject) === JSON.stringify(after15),
    limitAfter: limitAfterReject,
  };
  state.receipts["ceiling-reject6-error"] = over.txHash ?? "(no tx hash)";

  // --- Phase 3: remaining 5 units (succeeds) ---
  const tx5 = await client.token.transferSync({
    account: keyA,
    token: PRIMARY_TOKEN,
    to: treasury,
    amount: units(5n),
  });
  log(
    "ceiling",
    `5-unit transfer confirmed tx=${tx5.receipt.transactionHash} status=${tx5.receipt.status}`,
  );
  const after5 = await snapshotBalances(client, accounts, tokens);
  const limitAfter5 = await readLimit();
  results.transfer5 = {
    txHash: tx5.receipt.transactionHash,
    explorer: explorerLink(tx5.receipt.transactionHash),
    status: tx5.receipt.status,
    feePayer: tx5.receipt.feePayer,
    feeToken: tx5.receipt.feeToken,
    gasUsed: tx5.receipt.gasUsed?.toString(10),
    balancesAfter: after5,
    limitAfter: limitAfter5,
  };
  state.receipts["ceiling-5"] = tx5.receipt.transactionHash;
  saveState(state);

  // --- Fee-vs-limit accounting ---
  // If fees counted against the token limit, remaining after 20 units spent
  // would be negative/0 with extra deduction; we record actual remaining.
  const evidence = {
    step: "ceiling",
    mode: "confirmed testnet transaction",
    keyLabel: "A",
    ceilingConfigured: {
      limitBaseUnits: units(PERIOD_CEILING_UNITS).toString(10),
      periodSeconds: 86_400,
    },
    limitBefore,
    results,
    balancesBefore: before,
    balancesFinal: after5,
    feeVsLimitNotes:
      "Fee token (pathUSD) is separate from the limit token (AlphaUSD). Remaining-limit reads bracket each phase to show whether fees affect the limit.",
    knownErrorSelectors: KNOWN_ERROR_SELECTORS,
    expectedSpendingLimitSelector: toFunctionSelector(
      "SpendingLimitExceeded()",
    ),
    noteSelectorDecoding:
      "TIP-1011 names SpendingLimitExceeded() for overspend; actual selector recorded from any revert data surfaced by the node.",
  };
  console.log(JSON.stringify(jsonSafe(evidence), null, 2));
  recordEvidence("04-ceiling", evidence);
  log("ceiling", "OK");
}

if (process.argv[1]?.includes("ceiling")) {
  ceiling().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
