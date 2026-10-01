import type { Address, Hash } from "viem";
import { encodeFunctionData } from "viem";
import { tempoModerato } from "viem/chains";
import { Abis, Account, createClient, http } from "viem/tempo";
import {
  type Authorization,
  type AuthorizationRead,
  type ChainConfig,
  type IngestionCursor,
  type PaymentIntent,
  type PaymentOutcome,
  type TempoAdapter,
  type TransferEvent,
  UnresolvedSubmitError,
} from "@float/contracts";
import {
  TempoChainMismatchError,
  TempoPreflightRejectionError,
  classifyProtocolError,
} from "./errors.js";

/**
 * Verified Moderato testnet facts (see spike/RESULTS.md and
 * spike/evidence/01-verify-network.json for the live-verified values):
 * chainId 42431, RPC https://rpc.moderato.tempo.xyz, explorer
 * https://explore.testnet.tempo.xyz. Token decimals are read on-chain via
 * getTokenInfo — never assumed. The tokenAddress below is the faucet
 * alphaUSD token; callers should verify via getTokenInfo before pricing.
 */
export const MODERATO_TESTNET: ChainConfig = {
  chainId: 42_431,
  rpcUrl: "https://rpc.moderato.tempo.xyz",
  explorerUrl: "https://explore.testnet.tempo.xyz",
  tokenAddress: "0x20c0000000000000000000000000000000000001", // alphaUSD
} as const;

/** Default fee token: pathUSD, the default quote token (0x20c0...0000). */
export const FEE_TOKEN_ADDRESS: Address =
  "0x20c0000000000000000000000000000000000000";

/**
 * Maximum blocks scanned per ingestTransfers call so a lagging cursor cannot
 * produce unbounded log queries. Callers loop until caught up.
 */
export const MAX_INGEST_BLOCKS = 5_000;

/**
 * Minimal structural surface of the viem/tempo client the adapter uses.
 * Declared with method shorthand so the real viem client (specific chain
 * generics) and test fakes are both assignable.
 */
export type TempoClientLike = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  getBlockNumber(): Promise<bigint>;
  getLogs(args: {
    address: Address;
    event: unknown;
    args?: { to?: Address[] };
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<
    Array<{
      address: Address;
      args: { from: Address; to: Address; amount: bigint };
      blockNumber: bigint | number;
      blockHash: Hash | undefined;
      transactionHash: Hash | undefined;
      logIndex: number;
    }>
  >;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  getTransactionReceipt(args: { hash: Hash }): Promise<{
    status: string;
    transactionHash: Hash;
    blockNumber: bigint;
    gasUsed?: bigint;
    effectiveGasPrice?: bigint | string;
    feePayer?: Address;
    feeToken?: Address;
  } | null>;
  token: {
    getMetadata(args: {
      token: Address;
    }): Promise<{ name: string; symbol: string; decimals: number }>;
    getBalance(args: {
      account: Address;
      token: Address;
    }): Promise<{ amount: bigint }>;
    transfer(args: {
      account: unknown;
      token: Address;
      to: Address;
      amount: bigint;
    }): Promise<Hash>;
  };
  accessKey: {
    getMetadata(args: { account: Address; accessKey: Address }): Promise<{
      address: Address;
      keyType: string;
      expiry: bigint;
      spendPolicy: "limited" | "unlimited";
      isRevoked: boolean;
    }>;
    getRemainingLimit(args: {
      account: Address;
      accessKey: Address;
      token: Address;
    }): Promise<{ remaining: bigint; periodEnd: bigint | undefined }>;
  };
};

export type TempoAdapterOptions = {
  /**
   * Inject a pre-built client. Tests pass a fake; production leaves this
   * unset so a viem tempo client is created from the config's rpcUrl.
   */
  client?: TempoClientLike;
  /**
   * Delegated access-key account used to submit collection payments
   * (keyId bound to the merchant root). Spike-proven flow: the key signs a
   * Tempo tx whose sender is the merchant root account.
   */
  accessKeyAccount?: Account.AccessKeyAccount;
  /**
   * Merchant root account address. Required for authorization reads.
   * NOTE: the frozen Authorization DTO carries the key id but not the
   * merchant root chain address — this documented gap is raised in
   * HANDOFF.md; until contracts change, the binding is passed at
   * construction.
   */
  merchantAccountAddress?: Address;
  /** Fee token used for submissions (defaults to pathUSD). */
  feeTokenAddress?: Address;
};

const TIP20_TRANSFER_EVENT = {
  type: "event",
  name: "Transfer",
  inputs: [
    { type: "address", name: "from", indexed: true },
    { type: "address", name: "to", indexed: true },
    { type: "uint256", name: "amount", indexed: false },
  ],
} as const;

export function createTempoAdapter(
  config: ChainConfig,
  options: TempoAdapterOptions = {},
): TempoAdapter {
  const client: TempoClientLike =
    options.client ??
    (createClient({
      chain: tempoModerato,
      transport: http(config.rpcUrl, { timeout: 30_000, retryCount: 2 }),
      feeToken: options.feeTokenAddress ?? FEE_TOKEN_ADDRESS,
    }) as unknown as TempoClientLike);
  const feeToken: Address = options.feeTokenAddress ?? FEE_TOKEN_ADDRESS;
  const merchantAccount: Address | undefined = options.merchantAccountAddress;

  async function verifyNetwork(): Promise<{ chainId: number }> {
    const observed = Number(await client.request({ method: "eth_chainId" }));
    if (observed !== config.chainId) {
      throw new TempoChainMismatchError(config.chainId, observed);
    }
    return { chainId: observed };
  }

  return {
    implementation: "live",

    verifyNetwork,

    // SPIKE-PROVEN (spike/evidence/01-verify-network.json): token metadata
    // read on-chain via token.getMetadata; decimals 6 verified for all four
    // faucet tokens.
    async getTokenInfo(tokenAddress: Address) {
      await verifyNetwork();
      const meta = await client.token.getMetadata({ token: tokenAddress });
      return {
        address: tokenAddress,
        symbol: meta.symbol,
        decimals: meta.decimals,
        name: meta.name,
      };
    },

    // SPIKE-PROVEN (spike/evidence/03-authorize.json, 04-ceiling.json,
    // 06-expiry-revoke.json): accessKey.getMetadata + getRemainingLimit
    // return expiry, isRevoked, spendPolicy, remaining and periodEnd;
    // periodEnd = authorization_time + period (anchored, TIP-1011).
    async readAuthorization(
      authorization: Authorization,
    ): Promise<AuthorizationRead> {
      await verifyNetwork();
      if (!merchantAccount) {
        throw new Error(
          "readAuthorization requires the merchantAccountAddress binding (see HANDOFF.md contracts gap)",
        );
      }
      const nowSec = Math.floor(Date.now() / 1000);

      if (!authorization.authorizationTxHash) {
        return {
          state: "pending",
          remainingPeriodAllowance: null,
          currentPeriodEndSec: null,
          expirySec: authorization.expirySec ?? null,
        };
      }

      const meta = await client.accessKey.getMetadata({
        account: merchantAccount,
        accessKey: authorization.keyAddress as Address,
      });

      // The keychain returns a default entry (keyType secp256k1, expiry 0,
      // spendPolicy unlimited) when queried with an unknown key id (observed
      // during the spike when passing the root address as the key id).
      const unknownKey =
        meta.keyType === "secp256k1" &&
        meta.spendPolicy === "unlimited" &&
        meta.expiry === 0n;
      const expirySec: number | null =
        meta.expiry > 0n ? Number(meta.expiry) : null;

      let state: AuthorizationRead["state"];
      if (unknownKey) {
        state = "invalid";
      } else if (meta.isRevoked) {
        state = "revoked";
      } else if (expirySec !== null && expirySec <= nowSec) {
        state = "expired";
      } else {
        state = "valid";
      }

      let remainingPeriodAllowance: string | null = null;
      let currentPeriodEndSec: number | null = null;
      if (state === "valid") {
        const limit = await client.accessKey.getRemainingLimit({
          account: merchantAccount,
          accessKey: authorization.keyAddress as Address,
          token: authorization.tokenAddress as Address,
        });
        remainingPeriodAllowance = limit.remaining.toString(10);
        currentPeriodEndSec =
          limit.periodEnd && limit.periodEnd > 0n
            ? Number(limit.periodEnd)
            : null;
      }
      return {
        state,
        remainingPeriodAllowance,
        currentPeriodEndSec,
        expirySec,
      };
    },

    // SPIKE-PROVEN (spike/evidence/02-fund.json, 04-ceiling.json):
    // token.getBalance returns exact base-unit balances.
    async getBalance(account: Address, tokenAddress: Address): Promise<string> {
      await verifyNetwork();
      const balance = await client.token.getBalance({
        account,
        token: tokenAddress,
      });
      return balance.amount.toString(10);
    },

    /**
     * Reads confirmed TIP-20 `Transfer(address,address,uint256)` logs from
     * the cursor. SPIKE-PROVEN end-to-end (spike/evidence/09-ingest.json):
     * delegated transfers executed on testnet are re-read from chain logs
     * with gap-free cursor advancement and recipient filtering. Finality
     * (confirmation depth) policy is the caller's concern; this method scans
     * up to chain head.
     */
    async ingestTransfers(
      cursor: IngestionCursor,
      filter: {
        tokenAddress: Address;
        recipients?: Address[];
        senders?: Address[];
      },
    ): Promise<{
      events: TransferEvent[];
      nextCursor: IngestionCursor;
      scannedRange?: { fromBlockNumber: number; toBlockNumber: number };
    }> {
      await verifyNetwork();
      const head = Number(await client.getBlockNumber());
      if (cursor.nextBlockNumber > head) {
        return {
          events: [],
          nextCursor: {
            chainId: config.chainId,
            nextBlockNumber: cursor.nextBlockNumber,
          },
        };
      }
      const end = Math.min(
        head,
        cursor.nextBlockNumber + MAX_INGEST_BLOCKS - 1,
      );

      const logArgs: { from?: Address[]; to?: Address[] } = {};
      if (filter.senders?.length) logArgs.from = [...filter.senders];
      if (filter.recipients?.length) logArgs.to = [...filter.recipients];
      const logs = await client.getLogs({
        address: filter.tokenAddress,
        event: TIP20_TRANSFER_EVENT,
        args: Object.keys(logArgs).length ? logArgs : undefined,
        fromBlock: BigInt(cursor.nextBlockNumber),
        toBlock: BigInt(end),
      });

      const blockTimestamps = new Map<bigint, bigint>();
      const events: TransferEvent[] = [];
      for (const log of logs) {
        // Defensive: viem's log typing allows undefined identity fields;
        // logs without them cannot be identified and must never be ingested.
        if (!log.transactionHash || !log.blockHash) continue;
        const blockNumber = BigInt(log.blockNumber);
        let ts = blockTimestamps.get(blockNumber);
        if (ts === undefined) {
          const block = await client.getBlock({ blockNumber });
          ts = block.timestamp;
          blockTimestamps.set(blockNumber, ts);
        }
        events.push({
          chainId: config.chainId,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: Number(blockNumber),
          blockHash: log.blockHash,
          timestampSec: Number(ts),
          from: log.args.from,
          to: log.args.to,
          tokenAddress: filter.tokenAddress,
          amountBaseUnits: log.args.amount.toString(10),
        });
      }
      events.sort((a, b) =>
        a.blockNumber !== b.blockNumber
          ? a.blockNumber - b.blockNumber
          : a.logIndex - b.logIndex,
      );
      return {
        events,
        nextCursor: { chainId: config.chainId, nextBlockNumber: end + 1 },
        scannedRange: {
          fromBlockNumber: cursor.nextBlockNumber,
          toBlockNumber: end,
        },
      };
    },

    /**
     * Builds the scoped TIP-20 transfer call and preflights it.
     * SPIKE-PROVEN: over-cap and scope violations surface as
     * eth_estimateGas rejections with NO receipt, decoded via errors.ts —
     * see 04-ceiling.json (raw `0x8a9e71ea` SpendingLimitExceeded) and
     * 05-scopes.json (raw `0x576b38b4` CallNotAllowed).
     */
    async preparePayment(
      intent: PaymentIntent,
      ctx: { from: Address; to: Address; tokenAddress: Address },
    ): Promise<{
      prepared: true;
      estimatedFeeAmount: string | null;
      feeToken: Address | null;
    }> {
      await verifyNetwork();
      const amount = BigInt(intent.amount);
      if (amount <= 0n) {
        throw new TempoPreflightRejectionError(
          "invalid_amount",
          "payment amount must be positive",
          null,
        );
      }
      const data = encodeFunctionData({
        abi: Abis.tip20,
        functionName: "transfer",
        args: [ctx.to, amount],
      });

      let gas: bigint;
      try {
        gas = (await client.request({
          method: "eth_estimateGas",
          params: [{ from: ctx.from, to: ctx.tokenAddress, data }],
        })) as bigint;
      } catch (err) {
        const reasonCode =
          classifyProtocolError(err) ?? "unknown_protocol_error";
        throw new TempoPreflightRejectionError(
          reasonCode,
          String((err as Error).message).slice(0, 500),
          null,
        );
      }

      // Fee estimate: gas * gasPrice, in fee-token base units. Approximation
      // (the fee AMM conversion may vary slightly); receipts carry the exact
      // amount for reconciliation.
      let estimatedFeeAmount: string | null = null;
      try {
        const gasPrice = (await client.request({
          method: "eth_gasPrice",
        })) as bigint;
        estimatedFeeAmount = (gas * gasPrice).toString(10);
      } catch {
        estimatedFeeAmount = null;
      }
      return { prepared: true, estimatedFeeAmount, feeToken };
    },

    /**
     * Broadcasts the transfer for an already-persisted intent.
     * SPIKE-PROVEN: delegated TIP-20 transfers signed by an access key
     * confirm on-chain (04-ceiling.json / 07-reset.json). The unknown-outcome
     * branch (UnresolvedSubmitError) is implemented per the frozen contract,
     * but the live timeout scenario itself is NOT spike-proven.
     */
    async submitPayment(prepareRef: {
      intent: PaymentIntent;
      from: Address;
      to: Address;
      tokenAddress: Address;
    }): Promise<{ txHash: Hash }> {
      await verifyNetwork();
      if (!options.accessKeyAccount) {
        throw new Error(
          "submitPayment requires a bound accessKeyAccount (delegated collection key)",
        );
      }
      const amount = BigInt(prepareRef.intent.amount);
      let hash: Hash | null = null;
      try {
        // Broadcast WITHOUT waiting for the receipt: the hash is returned so
        // reconcilePayment can settle the outcome durably.
        hash = await client.token.transfer({
          account: options.accessKeyAccount,
          token: prepareRef.tokenAddress,
          to: prepareRef.to,
          amount,
        });
        return { txHash: hash };
      } catch (err) {
        const reasonCode = classifyProtocolError(err);
        if (reasonCode) {
          // Definitive preflight rejection: the chain refused the tx before
          // inclusion — no receipt exists, nothing moved.
          throw new TempoPreflightRejectionError(
            reasonCode,
            String((err as Error).message).slice(0, 500),
            null,
          );
        }
        // Unknown outcome (timeout, lost response): the caller keeps its
        // reservation and reconciles by tx identity. The hash may or may not
        // be known.
        throw new UnresolvedSubmitError(
          String((err as Error).message).slice(0, 500),
          hash,
        );
      }
    },

    /**
     * Reconciles a known transaction identity. SPIKE-PROVEN for receipt
     * reads: receipts expose status, feePayer and feeToken (02-fund.json,
     * 08-fees.json). The reverted-receipt path is implemented but NOT
     * spike-proven: every testnet rejection observed was a preflight
     * rejection without a receipt.
     */
    async reconcilePayment(txHash: Hash): Promise<PaymentOutcome> {
      const receipt = await client
        .getTransactionReceipt({ hash: txHash })
        .catch(() => null);
      if (!receipt) {
        return {
          status: "unresolved",
          txHash,
          detail: "receipt not found yet (transaction may still be pending)",
        };
      }
      if (receipt.status === "success") {
        const block = await client.getBlock({
          blockNumber: receipt.blockNumber,
        });
        const feeAmount =
          receipt.gasUsed && receipt.effectiveGasPrice
            ? (
                BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)
              ).toString(10)
            : undefined;
        return {
          status: "confirmed",
          txHash: receipt.transactionHash,
          blockNumber: Number(receipt.blockNumber),
          confirmedAtSec: Number(block.timestamp),
          feeAmount,
          feePayer: receipt.feePayer,
        };
      }
      return {
        status: "failed",
        reasonCode: "transaction_reverted",
        txHash: receipt.transactionHash,
        detail: `reverted in block ${receipt.blockNumber}`,
      };
    },
  } satisfies TempoAdapter;
}
