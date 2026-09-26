import type { ChainConfig, TempoAdapter } from "@float/contracts";

export type {
  ChainConfig,
  TempoAdapter,
  UnresolvedSubmitError,
} from "@float/contracts";

/**
 * Package B (G1) implements the live adapter here, using viem's Tempo
 * integration (`viem/tempo`), pinned to versions proven by the spike.
 * The spike evidence manifest (spike/RESULTS.md) is the source for the
 * verified chain ID, token address/decimals, RPC, and fee behavior.
 * Until G1 evidence exists, no live adapter may be constructed.
 */
export function createTempoAdapter(_config: ChainConfig): TempoAdapter {
  throw new Error(
    "createTempoAdapter: not implemented — verify network/token via the G1 spike first (PLAN.md section 7)",
  );
}
