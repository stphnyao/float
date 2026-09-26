import type { Authorization, AuthorizationRead } from "./authorization.js";
import type { IngestionCursor, TransferEvent } from "./revenue.js";
import type { PaymentIntent, PaymentOutcome } from "./payment.js";
import type { HexAddress } from "./money.js";

/**
 * Every chain interaction goes through this adapter so the rest of the
 * system is deterministic-testable. Fakes implement it too and MUST set
 * `implementation: "fake"` — a fake can never generate evidence that looks
 * like live-chain data.
 */
export interface TempoAdapter {
  readonly implementation: "live" | "fake";

  /** Verify we are talking to the expected network before any write. */
  verifyNetwork(): Promise<{ chainId: number }>;

  /** Read verified token metadata (decimals must come from here, never assumed). */
  getTokenInfo(tokenAddress: HexAddress): Promise<{
    address: HexAddress;
    symbol: string;
    decimals: number;
    name: string;
  }>;

  /** Read live authorization state: validity, remaining period allowance, expiry. */
  readAuthorization(authorization: Authorization): Promise<AuthorizationRead>;

  /** Spendable balance of an account in a token, base units as string. */
  getBalance(account: HexAddress, tokenAddress: HexAddress): Promise<string>;

  /**
   * Ingest confirmed transfers from `cursor` (inclusive) up to chain head.
   * Must only return confirmed events, support gap-free replay from the
   * returned cursor, and be idempotent per (chainId, txHash, logIndex).
   * Callers may filter by token and recipient set. A refund pass may filter
   * by `senders` instead: on-chain refunds leave the merchant, so they are
   * normalized to negative-amount TransferEvents (money.ts permits negatives
   * for adjustments) and classified by the policy layer.
   */
  ingestTransfers(
    cursor: IngestionCursor,
    filter: { tokenAddress: HexAddress; recipients?: HexAddress[]; senders?: HexAddress[] },
  ): Promise<{ events: TransferEvent[]; nextCursor: IngestionCursor }>;

  /**
   * Prepare a payment for the intent (build the scoped call). No state change.
   * Implementations should preflight and may report an estimated fee.
   */
  preparePayment(
    intent: PaymentIntent,
    ctx: { from: HexAddress; to: HexAddress; tokenAddress: HexAddress },
  ): Promise<{
    prepared: true;
    estimatedFeeAmount: string | null;
    feeToken: HexAddress | null;
  }>;

  /**
   * Broadcast the prepared payment for an already-persisted intent.
   * Returns the transaction identity. If the result is unknown (timeout,
   * lost response) implementations must throw UnresolvedSubmitError rather
   * than guessing success or failure.
   */
  submitPayment(prepareRef: {
    intent: PaymentIntent;
    from: HexAddress;
    to: HexAddress;
    tokenAddress: HexAddress;
  }): Promise<{ txHash: string }>;

  /**
   * Reconcile a known transaction identity to confirmed/failed. Must return
   * unresolved (not throw) while the outcome is genuinely unknown.
   */
  reconcilePayment(txHash: string): Promise<PaymentOutcome>;
}

/** Thrown when submission leaves the outcome unknown. Callers keep reservations. */
export class UnresolvedSubmitError extends Error {
  readonly txHash: string | null;
  constructor(detail: string, txHash: string | null) {
    super(`unresolved submission: ${detail}`);
    this.name = "UnresolvedSubmitError";
    this.txHash = txHash;
  }
}

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string | null;
  tokenAddress: HexAddress;
}
