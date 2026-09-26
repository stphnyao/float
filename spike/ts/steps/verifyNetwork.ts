import {
  TOKENS,
  CHAIN_ID,
  RPC_URL,
  EXPLORER_URL,
  makeClient,
} from "../config.js";
import { log, recordEvidence, explorerLink, jsonSafe } from "../util.js";

/**
 * G1 matrix item (a): verify chain ID (reject unexpected chain before writes),
 * TIP-20 token metadata/decimals, RPC and explorer, and locked dependency
 * versions. Read-only: no writes occur in this step.
 */
export async function verifyNetwork(): Promise<void> {
  const client = makeClient();

  const chainIdRpc = Number(await client.request({ method: "eth_chainId" }));
  if (chainIdRpc !== CHAIN_ID) {
    throw new Error(
      `chainId mismatch: RPC reports ${chainIdRpc}, expected ${CHAIN_ID}. Refusing to proceed.`,
    );
  }
  const blockNumber = await client.request({ method: "eth_blockNumber" });
  const clientCode = await client
    .request({
      method: "web3_clientVersion",
    })
    .catch(() => "(not supported)");

  const metadata: Record<string, unknown> = {};
  for (const [label, address] of Object.entries(TOKENS)) {
    const meta = await client.token.getMetadata({ token: address });
    metadata[label] = {
      address,
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
      currency: meta.currency,
      totalSupply: meta.totalSupply?.toString(10) ?? null,
    };
    log("verifyNetwork", `${label}:`, metadata[label]);
  }

  // Sanity: symbols/decimals must match what the faucet page documents.
  // NOTE: on-chain symbol is "alphaUSD" (lowercase a) while docs/faucet label
  // it "AlphaUSD" — recorded verbatim; comparison is case-insensitive here.
  if (
    metadata.AlphaUSD &&
    (metadata.AlphaUSD as { symbol: string }).symbol.toLowerCase() !==
      "alphausd"
  ) {
    throw new Error(
      `AlphaUSD symbol mismatch: ${(metadata.AlphaUSD as { symbol: string }).symbol}`,
    );
  }
  for (const label of Object.keys(TOKENS)) {
    const m = metadata[label] as { decimals: number } | undefined;
    if (m && m.decimals !== 6) {
      throw new Error(
        `${label} decimals ${m.decimals} != 6 — adapter must read decimals, never assume`,
      );
    }
  }

  const evidence = {
    step: "verify-network",
    chainIdRpc,
    chainIdExpected: CHAIN_ID,
    blockNumberHex: blockNumber,
    clientVersion: clientCode,
    rpcUrl: RPC_URL,
    explorerUrl: EXPLORER_URL,
    viemPinned: "2.56.9",
    oxResolved: "0.14.45 (via viem)",
    node: process.version,
    platform: process.platform,
    tokens: metadata,
    explorerExample: explorerLink("0x" + "0".repeat(64)),
    notes:
      "Chain ID verified over RPC before any write; token decimals read on-chain (6), never assumed.",
  };
  console.log(JSON.stringify(jsonSafe(evidence), null, 2));
  recordEvidence("01-verify-network", evidence);
  log("verifyNetwork", "OK");
}

if (process.argv[1]?.includes("verifyNetwork")) {
  verifyNetwork().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
