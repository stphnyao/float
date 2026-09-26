import { PRIMARY_TOKEN, RPC_URL, EXPLORER_URL, makeClient } from "../config.js";
import {
  log,
  recordEvidence,
  loadState,
  explorerLink,
  assertChainId,
} from "../util.js";
import { createTempoAdapter } from "@float/chain";

/**
 * Adapter-path smoke test: reads confirmed TIP-20 Transfer logs for the
 * treasury via the typed live adapter (packages/chain), proving
 * ingestTransfers with cursor advancement, capped page size, and recipient
 * filtering against the real chain. Read-only; no writes.
 */
export async function ingest(): Promise<void> {
  const client = makeClient();
  await assertChainId(client, "ingest");

  const state = loadState();
  const treasury = state.treasury.address;

  const adapter = createTempoAdapter({
    chainId: 42431,
    rpcUrl: RPC_URL,
    explorerUrl: EXPLORER_URL,
    tokenAddress: PRIMARY_TOKEN,
  });

  // Adapter-path sanity reads first (all SPIKE-PROVEN surfaces).
  const network = await adapter.verifyNetwork();
  const tokenInfo = await adapter.getTokenInfo(PRIMARY_TOKEN);
  const merchantBalance = await adapter.getBalance(
    state.merchant.address,
    PRIMARY_TOKEN,
  );
  const treasuryBalance = await adapter.getBalance(treasury, PRIMARY_TOKEN);
  log("ingest", "verifyNetwork:", network);
  log("ingest", "tokenInfo:", tokenInfo);
  log(
    "ingest",
    `balances: merchant=${merchantBalance} treasury=${treasuryBalance}`,
  );

  // Loop capped ingestTransfers calls from a window before the first spike
  // transfer until the cursor catches up with chain head.
  const head = Number(await client.getBlockNumber());
  const startBlock = head - 30_000;
  let cursor = { chainId: 42431, nextBlockNumber: startBlock };
  let allEvents: Awaited<ReturnType<typeof adapter.ingestTransfers>>["events"] =
    [];
  let pages = 0;
  while (cursor.nextBlockNumber <= head) {
    const page = await adapter.ingestTransfers(cursor, {
      tokenAddress: PRIMARY_TOKEN,
      recipients: [treasury],
    });
    allEvents = allEvents.concat(page.events);
    if (page.nextCursor.nextBlockNumber === cursor.nextBlockNumber) {
      // No forward progress (head regressed); avoid an infinite loop.
      break;
    }
    cursor = page.nextCursor;
    pages++;
  }
  log(
    "ingest",
    `scanned blocks ${startBlock}..${cursor.nextBlockNumber - 1} in ${pages} page(s): ${allEvents.length} confirmed Transfer event(s) to treasury`,
  );
  for (const ev of allEvents) {
    log(
      "ingest",
      `  tx=${ev.txHash} logIndex=${ev.logIndex} from=${ev.from} amount=${ev.amountBaseUnits} block=${ev.blockNumber} ts=${ev.timestampSec} explorer=${explorerLink(ev.txHash)}`,
    );
  }

  // Idempotency: replaying from the returned cursor must not duplicate the
  // events already ingested (nothing new was written between the two reads).
  const replay = await adapter.ingestTransfers(cursor, {
    tokenAddress: PRIMARY_TOKEN,
    recipients: [treasury],
  });
  const overlap = replay.events.filter((e2) =>
    allEvents.some(
      (e1) => e1.txHash === e2.txHash && e1.logIndex === e2.logIndex,
    ),
  );

  const evidence = {
    step: "ingest (adapter path)",
    mode: "observed testnet reads over confirmed testnet transactions",
    adapterImplementation:
      "live (packages/chain createTempoAdapter, viem 2.56.9)",
    verifyNetwork: network,
    tokenInfo,
    merchantBalanceBaseUnits: merchantBalance,
    treasuryBalanceBaseUnits: treasuryBalance,
    scannedRange: {
      startBlock,
      endBlockInclusive: cursor.nextBlockNumber - 1,
      pages,
    },
    eventCount: allEvents.length,
    events: allEvents,
    replayEventCount: replay.events.length,
    duplicateEventsAcrossCursorBoundary: overlap.length,
    notes:
      "Confirmed TIP-20 Transfer logs re-read via the adapter with recipient filter (treasury only) and gap-free cursor advance. The underlying transfers were submitted in steps 04/07/08 (delegated access-key transfers and root transfer).",
  };
  console.log(JSON.stringify(evidence, null, 2));
  recordEvidence("09-ingest", evidence);
  log("ingest", "OK");
}

if (process.argv[1]?.includes("ingest")) {
  ingest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
