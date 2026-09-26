import { FEE_TOKEN, PRIMARY_TOKEN, TOKENS, makeClient } from "../config.js";
import {
  jsonSafe,
  log,
  recordEvidence,
  loadState,
  explorerLink,
  assertChainId,
  snapshotBalances,
} from "../util.js";
import { rootFromPrivateKey } from "../config.js";

/**
 * G1 matrix item (g): fee behavior. Identifies the fee token, the fee payer,
 * and their effect on balances/limits, from a direct root-key transfer
 * (root -> treasury) whose receipt is captured with full fee fields, plus
 * balance deltas for sender and fee payer.
 */
export async function fees(): Promise<void> {
  const client = makeClient();
  await assertChainId(client, "fees");

  const state = loadState();
  const merchant = rootFromPrivateKey(state.merchant.privateKey);
  const treasury = state.treasury.address;

  const accounts = [
    { label: "merchant", address: merchant.address },
    { label: "treasury", address: treasury },
  ];
  const tokens = [
    { label: "pathUSD", address: TOKENS.pathUSD },
    { label: "AlphaUSD", address: PRIMARY_TOKEN },
  ];
  const before = await snapshotBalances(client, accounts, tokens);
  log("fees", "balances before:", before);

  // Direct root-key transfer: receipt exposes feePayer/feeToken/gas fields.
  const tx = await client.token.transferSync({
    account: merchant,
    token: PRIMARY_TOKEN,
    to: treasury,
    amount: 1n, // one base unit: keeps principal movement trivial
  });
  const receipt = tx.receipt;
  log(
    "fees",
    `transfer receipt: hash=${receipt.transactionHash} status=${receipt.status} feePayer=${receipt.feePayer} feeToken=${receipt.feeToken} gasUsed=${receipt.gasUsed} effectiveGasPrice=${receipt.effectiveGasPrice}`,
  );

  const after = await snapshotBalances(client, accounts, tokens);
  log("fees", "balances after:", after);

  const feeTokenUsed = receipt.feeToken ?? FEE_TOKEN;
  const evidence = {
    step: "fees",
    mode: "confirmed testnet transaction",
    transferTxHash: receipt.transactionHash,
    explorer: explorerLink(receipt.transactionHash),
    receiptStatus: receipt.status,
    feePayer: receipt.feePayer,
    feeTokenUsed,
    feeTokenIsDefaultQuoteToken: feeTokenUsed.toLowerCase() === TOKENS.pathUSD,
    gasUsed: receipt.gasUsed?.toString(10),
    effectiveGasPrice: receipt.effectiveGasPrice?.toString(10),
    type: receipt.type,
    balancesBefore: before,
    balancesAfter: after,
    feeEffectNotes: [
      "Tempo has no native gas token: fees are paid in a TIP-20 fee token set per transaction/client (client default here: pathUSD 0x20c0...0000).",
      "feePayer on the receipt identifies who paid; by default the sender (merchant root) pays its own fees.",
      "Access-key limit accounting: limits are per-token on transfer amounts; the ceiling step brackets remaining-limit reads around transfers to show fee effects (if any) on the limit.",
      "Funding documented: merchant root needs fee-token (pathUSD) balance + the collection token (AlphaUSD); access keys sign but the ROOT account is the fee payer by default.",
    ],
    allFundingSources: [
      "Programmatic faucet (no auth): https://tempo.xyz/developers/api/faucet — mints 1M of each pathUSD/AlphaUSD/BetaUSD/ThetaUSD per request to a lowercase address.",
    ],
  };
  console.log(JSON.stringify(jsonSafe(evidence), null, 2));
  recordEvidence("08-fees", evidence);
  log("fees", "OK");
}

if (process.argv[1]?.includes("fees")) {
  fees().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
