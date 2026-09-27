import type { ChainConfig, HexAddress } from "@float/contracts";

/**
 * Worker configuration. Everything chain-related must come from verified
 * configuration, never assumptions (PLAN section 7 G1). Defaults target the
 * Tempo Moderato testnet verified by the G1 spike (chain id 42431, TIP-20
 * tokens with 6 decimals, fees paid in the pathUSD fee token).
 */
export interface WorkerConfig {
  databaseUrl: string;
  chain: ChainConfig;
  /** The single supported merchant wallet integration for this deployment. */
  merchantAddress: HexAddress;
  /** Float treasury (disbursement source; collections recipient). */
  treasuryAddress: HexAddress;
  /** Faucet distribution senders excluded from revenue. */
  faucetSenders: HexAddress[];
  /** Known merchant-controlled funding sources (self-funding exclusion). */
  knownSelfFundingSources: HexAddress[];
  /** Identified non-sale senders (grants, platform credits, ...). */
  knownNonSaleSenders: HexAddress[];
  /** Block to start receipt scanning from. */
  ingestStartBlock: number;
  pollIntervalMs: number;
}

const HEX32_ZEROS = "0x0000000000000000000000000000000000000000";

function parseList(value: string | undefined): HexAddress[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => /^0x[0-9a-fA-F]{40}$/.test(v)) as HexAddress[];
}

/**
 * Builds config from the environment. The token address placeholder
 * (all-zero address) is intentionally invalid for live writes: a live run
 * MUST set TEMPO_TOKEN_ADDRESS to the verified TIP-20 token. Fakes/tests
 * inject their own configuration and never read these defaults.
 */
export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const tokenAddress = (env.TEMPO_TOKEN_ADDRESS ?? HEX32_ZEROS) as HexAddress;
  const merchantAddress = (env.FLOAT_MERCHANT_ADDRESS ??
    HEX32_ZEROS) as HexAddress;
  const treasuryAddress = (env.FLOAT_TREASURY_ADDRESS ??
    HEX32_ZEROS) as HexAddress;
  const chainId = Number.parseInt(env.TEMPO_CHAIN_ID ?? "42431", 10);
  return {
    databaseUrl:
      env.DATABASE_URL ?? "postgres://float:float@localhost:54329/float",
    chain: {
      chainId,
      rpcUrl: env.TEMPO_RPC_URL ?? "",
      explorerUrl: env.TEMPO_EXPLORER_URL ?? null,
      tokenAddress,
    },
    merchantAddress,
    treasuryAddress,
    faucetSenders: parseList(env.FLOAT_FAUCET_SENDERS),
    knownSelfFundingSources: parseList(env.FLOAT_SELF_FUNDING_SOURCES),
    knownNonSaleSenders: parseList(env.FLOAT_NON_SALE_SENDERS),
    ingestStartBlock: Number.parseInt(env.FLOAT_INGEST_START_BLOCK ?? "0", 10),
    pollIntervalMs: Number.parseInt(env.FLOAT_POLL_INTERVAL_MS ?? "15000", 10),
  };
}
