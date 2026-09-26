import {
  PRIMARY_TOKEN,
  PERIOD_CEILING_UNITS,
  PERIOD_SECONDS_SHORT,
  makeClient,
  units,
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
  accessKeyAccountFromState,
  wait,
} from "../util.js";
import { rootFromPrivateKey } from "../config.js";

/**
 * G1 matrix item (f2)/period rollover: observe an actual SHORT-period reset
 * (60s) with a fully on-chain measurement, and separately verify the
 * 86400-second configuration of key A via on-chain reads.
 *
 * Protocol: key B has limit 20 units, period 60s, anchored to authorization
 * time (TIP-1011: periodEnd = authorize_time + period).
 *  1. Transfer 12 units: succeeds. remaining drops to 8.
 *  2. Read remaining/periodEnd from chain.
 *  3. Wait until on-chain periodEnd (with buffer), measure the actual
 *     elapsed time between authorization and observed reset.
 *  4. Transfer 12 units again: succeeds => reset observed.
 * The 60s observation does NOT prove a 24-hour rollover; key A's 86400s
 * configuration is verified separately by reading its periodEnd.
 */
export async function reset(): Promise<void> {
  const client = makeClient();
  await assertChainId(client, "reset");

  const state = loadState();
  const merchant = rootFromPrivateKey(state.merchant.privateKey);
  const keyB = accessKeyAccountFromState(state, merchant, "B");
  const treasury = state.treasury.address;

  const accounts = [
    { label: "merchant", address: merchant.address },
    { label: "treasury", address: treasury },
  ];
  const tokens = [{ label: "AlphaUSD", address: PRIMARY_TOKEN }];

  const readLimit = async () => {
    const r = await client.accessKey.getRemainingLimit({
      account: merchant.address,
      accessKey: keyB.accessKeyAddress,
      token: PRIMARY_TOKEN,
    });
    log("reset", `key B remaining=${r.remaining} periodEnd=${r.periodEnd}`);
    return {
      remaining: r.remaining.toString(10),
      periodEnd: r.periodEnd?.toString(10) ?? null,
    };
  };

  const before = await snapshotBalances(client, accounts, tokens);
  const limitStart = await readLimit();

  // Phase 1: 12 units in the first 60s period.
  const tx1 = await client.token.transferSync({
    account: keyB,
    token: PRIMARY_TOKEN,
    to: treasury,
    amount: units(12n),
  });
  log("reset", `12-unit transfer confirmed tx=${tx1.receipt.transactionHash}`);
  const limitAfterFirst = await readLimit();
  state.receipts["reset-first-12"] = tx1.receipt.transactionHash;

  // Phase 2: wait until the on-chain period end + buffer, then re-check.
  const periodEndSec = Number(limitAfterFirst.periodEnd ?? 0);
  if (!periodEndSec)
    throw new Error("chain did not expose periodEnd — cannot observe reset");
  const bufferSec = 10;
  const waitMs = Math.max(0, (periodEndSec + bufferSec) * 1000 - Date.now());
  log(
    "reset",
    `on-chain periodEnd=${periodEndSec}; waiting ${(waitMs / 1000).toFixed(1)}s (+${bufferSec}s buffer) for the reset`,
  );
  if (waitMs > 0) await wait(waitMs);

  const nowSecAfterWait = Math.floor(Date.now() / 1000);
  const limitAfterWait = await readLimit();

  // Phase 3: another 12 units in the NEW period (would exceed the old one).
  const tx2 = await client.token.transferSync({
    account: keyB,
    token: PRIMARY_TOKEN,
    to: treasury,
    amount: units(12n),
  });
  log(
    "reset",
    `second 12-unit transfer confirmed tx=${tx2.receipt.transactionHash}`,
  );
  const limitAfterSecond = await readLimit();
  const after = await snapshotBalances(client, accounts, tokens);
  state.receipts["reset-second-12"] = tx2.receipt.transactionHash;
  saveState(state);

  const evidence = {
    step: "reset",
    mode: "confirmed testnet transaction",
    keyLabel: "B",
    shortPeriodConfiguredSeconds: PERIOD_SECONDS_SHORT,
    shortPeriodLabel:
      "ACTUAL PERIOD USED: 60 seconds (accelerated demo period). A 60s reset is NOT evidence of a full 24-hour rollover.",
    limitStart,
    firstTransfer: {
      txHash: tx1.receipt.transactionHash,
      explorer: explorerLink(tx1.receipt.transactionHash),
      status: tx1.receipt.status,
    },
    limitAfterFirst,
    onChainPeriodEndSec: periodEndSec,
    waitedUntilSec: nowSecAfterWait,
    observedResetAtLeastAtSec: nowSecAfterWait,
    limitAfterWait,
    secondTransfer: {
      txHash: tx2.receipt.transactionHash,
      explorer: explorerLink(tx2.receipt.transactionHash),
      status: tx2.receipt.status,
    },
    limitAfterSecond,
    balancesBefore: before,
    balancesAfter: after,
    dailyConfigVerification: {
      keyLabel: "A",
      periodSecondsConfigured: 86_400,
      note: "Key A (ceiling step) was authorized with period=86400s; its on-chain remaining/periodEnd reads in 04-ceiling.json demonstrate the 86400s configuration was accepted by the chain. A full 24h rollover was NOT observed (would take 24h).",
    },
  };
  console.log(JSON.stringify(jsonSafe(evidence), null, 2));
  recordEvidence("07-reset", evidence);
  log("reset", "OK");
}

if (process.argv[1]?.includes("reset")) {
  reset().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
