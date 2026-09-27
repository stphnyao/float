import type { Address, Hex } from "viem";
import { tempoModerato } from "viem/chains";
import { Account, P256, Secp256k1, createClient, http } from "viem/tempo";

/**
 * Deployed testnet facts verified against:
 *   - https://tempo.xyz/developers/docs/quickstart/connection-details (fetched 2026-09-26):
 *     Moderato testnet chain ID 42431, RPC https://rpc.moderato.tempo.xyz,
 *     explorer https://explore.testnet.tempo.xyz.
 *   - Live RPC `eth_chainId` returned 0xa5bf (42431) on 2026-09-26.
 *   - https://tempo.xyz/developers/docs/quickstart/faucet (fetched 2026-09-26):
 *     programmatic faucet, no login, 1M of each test token per request:
 *     pathUSD  0x20c0000000000000000000000000000000000000
 *     AlphaUSD 0x20c0000000000000000000000000000000000001
 *     BetaUSD  0x20c0000000000000000000000000000000000002
 *     ThetaUSD 0x20c0000000000000000000000000000000000003
 *   - viem 2.56.9 `tempoModerato` chain definition (id 42431, same RPC/explorer).
 */
export const CHAIN_ID = 42431;
export const RPC_URL =
  process.env.TEMPO_RPC_URL ?? "https://rpc.moderato.tempo.xyz";
export const EXPLORER_URL = "https://explore.testnet.tempo.xyz";
export const FAUCET_URL =
  process.env.TEMPO_FAUCET_URL ?? "https://tempo.xyz/developers/api/faucet";

export const TOKENS = {
  pathUSD: "0x20c0000000000000000000000000000000000000",
  AlphaUSD: "0x20c0000000000000000000000000000000000001",
  BetaUSD: "0x20c0000000000000000000000000000000000002",
  ThetaUSD: "0x20c0000000000000000000000000000000000003",
} as const satisfies Record<string, Address>;

/** Primary demo/collection token for the G1 matrix. */
export const PRIMARY_TOKEN = TOKENS.AlphaUSD;
/** Fee token used explicitly for determinism (default quote token). */
export const FEE_TOKEN = TOKENS.pathUSD;

/** G1 matrix constants. */
export const PERIOD_CEILING_UNITS = 20n; // token units (whole)
export const PERIOD_SECONDS_DAILY = 86_400;
export const PERIOD_SECONDS_SHORT = 60;

export function units(n: bigint, decimals = 6): bigint {
  return n * 10n ** BigInt(decimals);
}

export function makeClient() {
  if (tempoModerato.id !== CHAIN_ID) {
    throw new Error(
      `refusing to run: loaded chain id ${tempoModerato.id} != verified testnet chain id ${CHAIN_ID}`,
    );
  }
  return createClient({
    chain: tempoModerato,
    transport: http(RPC_URL, { timeout: 30_000, retryCount: 2 }),
    feeToken: FEE_TOKEN,
  });
}

export type SpikeClient = ReturnType<typeof makeClient>;

/** Root accounts are standard secp256k1 EOAs; access keys are P256. */
export function newRootAccount(): {
  account: Account.RootAccount;
  privateKey: Hex;
} {
  const privateKey: Hex = Secp256k1.randomPrivateKey();
  return { account: Account.fromSecp256k1(privateKey), privateKey };
}

export function rootFromPrivateKey(privateKey: Hex): Account.RootAccount {
  return Account.fromSecp256k1(privateKey);
}

export function newAccessKeyAccount(root: Account.RootAccount): {
  account: Account.AccessKeyAccount;
  privateKey: Hex;
} {
  // Random throwaway keys only; never persisted or logged (see RESULTS.md).
  const privateKey: Hex = P256.randomPrivateKey();
  return {
    account: Account.fromP256(privateKey, { access: root }),
    privateKey,
  };
}

export function accessKeyFromPrivateKey(
  privateKey: Hex,
  root: Account.RootAccount,
): Account.AccessKeyAccount {
  return Account.fromP256(privateKey, { access: root });
}

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}
