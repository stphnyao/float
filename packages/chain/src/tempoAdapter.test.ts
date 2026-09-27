import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  type Authorization,
  type IngestionCursor,
  type PaymentIntent,
  type TempoAdapter,
  UnresolvedSubmitError,
} from "@float/contracts";
import {
  createTempoAdapter,
  FEE_TOKEN_ADDRESS,
  type TempoClientLike,
} from "./tempoAdapter.js";
import {
  TempoChainMismatchError,
  TempoPreflightRejectionError,
  classifyProtocolError,
  decodeRevertSelector,
} from "./errors.js";

const CHAIN_ID = 42_431;
const TOKEN: Address = "0x20c0000000000000000000000000000000000001";
const MERCHANT: Address = "0x1111111111111111111111111111111111111111";
const KEY_ID: Address = "0x2222222222222222222222222222222222222222";
const TREASURY: Address = "0xc197057273DccE7629ca33488f6F65bC105031F7";

const CONFIG = {
  chainId: CHAIN_ID,
  rpcUrl: "https://rpc.moderato.tempo.xyz",
  explorerUrl: "https://explore.testnet.tempo.xyz",
  tokenAddress: TOKEN,
};

/** Build a fake viem/tempo client exercising only the surface the adapter uses. */
function fakeClient(overrides: Record<string, unknown> = {}): TempoClientLike {
  const base: Record<string, unknown> = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return `0x${CHAIN_ID.toString(16)}`;
      if (method === "eth_gasPrice") return 10_000_000_000n;
      if (method === "eth_estimateGas") return 50_000n;
      throw new Error(`unexpected rpc method ${method}`);
    }),
    getBlockNumber: vi.fn(async () => 1000n),
    getLogs: vi.fn(async () => []),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
      timestamp: 1_700_000_000n + blockNumber,
    })),
    getTransactionReceipt: vi.fn(async () => null),
    token: {
      getMetadata: vi.fn(async () => ({
        name: "AlphaUSD",
        symbol: "alphaUSD",
        decimals: 6,
        currency: "USD",
        logoURI: "",
      })),
      getBalance: vi.fn(async () => ({
        amount: 1_000_000n,
        decimals: 6,
        formatted: "1",
      })),
      transfer: vi.fn(async () => "0x" + "ab".repeat(32)),
    },
    accessKey: {
      getMetadata: vi.fn(async () => ({
        address: KEY_ID,
        keyType: "p256",
        expiry: 4_000_000_000n,
        spendPolicy: "limited",
        isRevoked: false,
      })),
      getRemainingLimit: vi.fn(async () => ({
        remaining: 5_000_000n,
        periodEnd: 1_800_000_000n,
      })),
    },
    ...overrides,
  };
  return base as unknown as TempoClientLike;
}

function makeIntent(amount: string): PaymentIntent {
  return {
    id: "0b8fd981-6f04-4e5b-aef1-dc8a4cf3a2f7",
    kind: "collection",
    idempotencyKey: "advance-1/period-1",
    advanceId: "0b8fd981-6f04-4e5b-aef1-dc8a4cf3a2f8",
    budgetId: null,
    amount,
    state: "submitted",
    txHash: null,
    nonceKey: null,
    createdAtSec: 0,
    updatedAtSec: 0,
  };
}

function makeAuthorization(): Authorization {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    id: "0b8fd981-6f04-4e5b-aef1-dc8a4cf3a2f9",
    merchantId: "0b8fd981-6f04-4e5b-aef1-dc8a4cf3a2fa",
    advanceId: null,
    chainId: CHAIN_ID,
    tokenAddress: TOKEN,
    keyAddress: KEY_ID,
    keyPublicKey: "0x9a",
    scopes: [
      {
        contractAddress: TOKEN,
        selector: "transfer(address,uint256)",
        recipients: [TREASURY],
      },
    ],
    periodSeconds: 86_400,
    periodCeilingAmount: "20000000",
    expirySec: nowSec + 86_400,
    state: "valid",
    authorizationTxHash: "0x" + "cd".repeat(32),
    revokedTxHash: null,
    witness: null,
    confirmedAtSec: nowSec,
    revokedConfirmedAtSec: null,
    createdAtSec: nowSec,
    updatedAtSec: nowSec,
  };
}

describe("createTempoAdapter (fake transport)", () => {
  it("verifyNetwork passes on the expected chain and rejects mismatches", async () => {
    const ok = createTempoAdapter(CONFIG, {
      client: fakeClient(),
      merchantAccountAddress: MERCHANT,
    });
    await expect(ok.verifyNetwork()).resolves.toEqual({ chainId: CHAIN_ID });

    const bad = createTempoAdapter(CONFIG, {
      client: fakeClient({
        request: vi.fn(async ({ method }: { method: string }) => {
          if (method === "eth_chainId") return "0x1"; // mainnet!
          throw new Error(`unexpected ${method}`);
        }),
      }),
      merchantAccountAddress: MERCHANT,
    });
    await expect(bad.verifyNetwork()).rejects.toBeInstanceOf(
      TempoChainMismatchError,
    );
    // Writes are refused on the mismatched chain, not just reads.
    await expect(bad.getBalance(MERCHANT, TOKEN)).rejects.toBeInstanceOf(
      TempoChainMismatchError,
    );
  });

  it("getTokenInfo reads decimals from the chain rather than assuming", async () => {
    const adapter = createTempoAdapter(CONFIG, {
      client: fakeClient(),
      merchantAccountAddress: MERCHANT,
    });
    await expect(adapter.getTokenInfo(TOKEN)).resolves.toEqual({
      address: TOKEN,
      symbol: "alphaUSD",
      decimals: 6,
      name: "AlphaUSD",
    });
  });

  it("getBalance returns base units as a decimal string", async () => {
    const adapter = createTempoAdapter(CONFIG, {
      client: fakeClient(),
      merchantAccountAddress: MERCHANT,
    });
    await expect(adapter.getBalance(MERCHANT, TOKEN)).resolves.toBe("1000000");
  });

  it("readAuthorization maps live key state (valid/expired/revoked/invalid/pending)", async () => {
    const adapter = createTempoAdapter(CONFIG, {
      client: fakeClient(),
      merchantAccountAddress: MERCHANT,
    });
    await expect(
      adapter.readAuthorization(makeAuthorization()),
    ).resolves.toEqual({
      state: "valid",
      remainingPeriodAllowance: "5000000",
      currentPeriodEndSec: 1_800_000_000,
      expirySec: 4_000_000_000,
    });

    const revoked = createTempoAdapter(CONFIG, {
      client: fakeClient({
        accessKey: {
          getMetadata: vi.fn(async () => ({
            address: KEY_ID,
            keyType: "p256",
            expiry: 4_000_000_000n,
            spendPolicy: "limited",
            isRevoked: true,
          })),
          getRemainingLimit: vi.fn(async () => ({
            remaining: 0n,
            periodEnd: 0n,
          })),
        },
      }),
      merchantAccountAddress: MERCHANT,
    });
    const read = await revoked.readAuthorization(makeAuthorization());
    expect(read.state).toBe("revoked");
    expect(read.remainingPeriodAllowance).toBeNull();

    const expired = createTempoAdapter(CONFIG, {
      client: fakeClient({
        accessKey: {
          getMetadata: vi.fn(async () => ({
            address: KEY_ID,
            keyType: "p256",
            expiry: 1n,
            spendPolicy: "limited",
            isRevoked: false,
          })),
          getRemainingLimit: vi.fn(async () => ({
            remaining: 0n,
            periodEnd: 0n,
          })),
        },
      }),
      merchantAccountAddress: MERCHANT,
    });
    expect((await expired.readAuthorization(makeAuthorization())).state).toBe(
      "expired",
    );

    // Unknown key id: the keychain returns the default entry.
    const unknown = createTempoAdapter(CONFIG, {
      client: fakeClient({
        accessKey: {
          getMetadata: vi.fn(async () => ({
            address: KEY_ID,
            keyType: "secp256k1",
            expiry: 0n,
            spendPolicy: "unlimited",
            isRevoked: false,
          })),
          getRemainingLimit: vi.fn(async () => ({
            remaining: 0n,
            periodEnd: 0n,
          })),
        },
      }),
      merchantAccountAddress: MERCHANT,
    });
    expect((await unknown.readAuthorization(makeAuthorization())).state).toBe(
      "invalid",
    );

    // Unconfirmed authorization: pending, no chain reads beyond chainId.
    const pendingAuth = { ...makeAuthorization(), authorizationTxHash: null };
    expect((await adapter.readAuthorization(pendingAuth)).state).toBe(
      "pending",
    );
  });

  it("ingestTransfers returns confirmed transfer logs with cursor advance and recipient filter", async () => {
    const logs = [
      {
        address: TOKEN,
        args: { from: MERCHANT, to: TREASURY, amount: 15_000_000n },
        blockNumber: 998n,
        blockHash: "0x" + "11".repeat(32),
        transactionHash: "0x" + "aa".repeat(32),
        logIndex: 0,
      },
      {
        address: TOKEN,
        args: {
          from: MERCHANT,
          to: "0x3333333333333333333333333333333333333333",
          amount: 1n,
        },
        blockNumber: 999n,
        blockHash: "0x" + "22".repeat(32),
        transactionHash: "0x" + "bb".repeat(32),
        logIndex: 1,
      },
    ];
    // Fake simulates the node's server-side filtering by the args.to topic.
    const getLogs = vi.fn(async (ga: { args?: { to?: Address[] } }) =>
      ga.args?.to?.length
        ? logs.filter((l) => (ga.args?.to ?? []).includes(l.args.to as Address))
        : logs,
    );
    const adapter = createTempoAdapter(CONFIG, {
      client: fakeClient({ getLogs }),
      merchantAccountAddress: MERCHANT,
    });
    const cursor: IngestionCursor = { chainId: CHAIN_ID, nextBlockNumber: 900 };
    const { events, nextCursor } = await adapter.ingestTransfers(cursor, {
      tokenAddress: TOKEN,
      recipients: [TREASURY],
    });

    // Only the treasury recipient's transfer is returned.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      chainId: CHAIN_ID,
      txHash: "0x" + "aa".repeat(32),
      logIndex: 0,
      blockNumber: 998,
      timestampSec: 1_700_000_998,
      from: MERCHANT,
      to: TREASURY,
      tokenAddress: TOKEN,
      amountBaseUnits: "15000000",
    });
    expect(nextCursor).toEqual({ chainId: CHAIN_ID, nextBlockNumber: 1001 });

    // Recipient filter was pushed down to getLogs.
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ args: { to: [TREASURY] } }),
    );

    // Cursor at head: empty result, cursor unchanged (no progress backwards).
    const res2 = await adapter.ingestTransfers(
      { chainId: CHAIN_ID, nextBlockNumber: 5000 },
      { tokenAddress: TOKEN },
    );
    expect(res2.events).toHaveLength(0);
    expect(res2.nextCursor.nextBlockNumber).toBe(5000);
  });

  it("preparePayment preflights and maps the decoded protocol error", async () => {
    const adapter = createTempoAdapter(CONFIG, {
      client: fakeClient(),
      merchantAccountAddress: MERCHANT,
    });
    const result = await adapter.preparePayment(makeIntent("1000"), {
      from: MERCHANT,
      to: TREASURY,
      tokenAddress: TOKEN,
    });
    expect(result).toEqual({
      prepared: true,
      estimatedFeeAmount: (50_000n * 10_000_000_000n).toString(10),
      feeToken: FEE_TOKEN_ADDRESS,
    });

    // Over-cap: chain rejects estimation with SpendingLimitExceeded (the
    // selector observed live in the spike, 04-ceiling.json).
    const rejecting = createTempoAdapter(CONFIG, {
      client: fakeClient({
        request: vi.fn(async ({ method }: { method: string }) => {
          if (method === "eth_chainId") return `0x${CHAIN_ID.toString(16)}`;
          if (method === "eth_estimateGas") {
            const err = new Error(
              "execution reverted: Account keychain error: SpendingLimitExceeded(SpendingLimitExceeded)",
            ) as Error & { data?: string };
            err.data = "0x8a9e71ea";
            throw err;
          }
          throw new Error(`unexpected ${method}`);
        }),
      }),
      merchantAccountAddress: MERCHANT,
    });
    await expect(
      rejecting.preparePayment(makeIntent("6000000"), {
        from: MERCHANT,
        to: TREASURY,
        tokenAddress: TOKEN,
      }),
    ).rejects.toMatchObject({
      name: "TempoPreflightRejectionError",
      reasonCode: "spending_limit_exceeded",
    });
  });

  it("submitPayment returns the broadcast hash and throws typed errors", async () => {
    const fakeKey = { address: KEY_ID, type: "accessKey" };
    const adapter = createTempoAdapter(CONFIG, {
      client: fakeClient(),
      merchantAccountAddress: MERCHANT,
      accessKeyAccount: fakeKey as never,
    });
    await expect(
      adapter.submitPayment({
        intent: makeIntent("100"),
        from: MERCHANT,
        to: TREASURY,
        tokenAddress: TOKEN,
      }),
    ).resolves.toEqual({ txHash: "0x" + "ab".repeat(32) });

    // Unbound adapter cannot submit.
    const unbound = createTempoAdapter(CONFIG, {
      client: fakeClient(),
      merchantAccountAddress: MERCHANT,
    });
    await expect(
      unbound.submitPayment({
        intent: makeIntent("100"),
        from: MERCHANT,
        to: TREASURY,
        tokenAddress: TOKEN,
      }),
    ).rejects.toThrow(/accessKeyAccount/);

    // Unknown outcome: timeout during broadcast -> UnresolvedSubmitError.
    const timeoutAdapter = createTempoAdapter(CONFIG, {
      client: fakeClient({
        token: {
          transfer: vi.fn(async () => {
            throw new Error("Request timed out");
          }),
        },
      }),
      merchantAccountAddress: MERCHANT,
      accessKeyAccount: fakeKey as never,
    });
    const err = await timeoutAdapter
      .submitPayment({
        intent: makeIntent("100"),
        from: MERCHANT,
        to: TREASURY,
        tokenAddress: TOKEN,
      })
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe("UnresolvedSubmitError");
    expect((err as { txHash: string | null }).txHash).toBeNull();

    // Definitive preflight rejection during broadcast is NOT unresolved.
    const scopeAdapter = createTempoAdapter(CONFIG, {
      client: fakeClient({
        token: {
          transfer: vi.fn(async () => {
            const err = new Error(
              "execution reverted: Account keychain error: CallNotAllowed(CallNotAllowed)",
            ) as Error & { data?: string };
            err.data = "0x576b38b4";
            throw err;
          }),
        },
      }),
      merchantAccountAddress: MERCHANT,
      accessKeyAccount: fakeKey as never,
    });
    await expect(
      scopeAdapter.submitPayment({
        intent: makeIntent("100"),
        from: MERCHANT,
        to: TREASURY,
        tokenAddress: TOKEN,
      }),
    ).rejects.toBeInstanceOf(TempoPreflightRejectionError);
  });

  it("reconcilePayment maps receipts to confirmed/failed/unresolved outcomes", async () => {
    const confirmedAdapter = createTempoAdapter(CONFIG, {
      client: fakeClient({
        getTransactionReceipt: vi.fn(async () => ({
          status: "success",
          transactionHash: "0x" + "cd".repeat(32),
          blockNumber: 999n,
          gasUsed: 39_918n,
          effectiveGasPrice: 10_225_000_000n,
          feePayer: MERCHANT,
          feeToken: FEE_TOKEN_ADDRESS,
        })),
      }),
      merchantAccountAddress: MERCHANT,
    });
    const confirmed = await confirmedAdapter.reconcilePayment(
      "0x" + "cd".repeat(32),
    );
    expect(confirmed).toMatchObject({
      status: "confirmed",
      txHash: "0x" + "cd".repeat(32),
      blockNumber: 999,
      confirmedAtSec: 1_700_000_999,
      feeAmount: (39_918n * 10_225_000_000n).toString(10),
      feePayer: MERCHANT,
    });

    const unresolvedAdapter = createTempoAdapter(CONFIG, {
      client: fakeClient({ getTransactionReceipt: vi.fn(async () => null) }),
      merchantAccountAddress: MERCHANT,
    });
    const unresolved = await unresolvedAdapter.reconcilePayment(
      "0x" + "cd".repeat(32),
    );
    expect(unresolved.status).toBe("unresolved");

    const failedAdapter = createTempoAdapter(CONFIG, {
      client: fakeClient({
        getTransactionReceipt: vi.fn(async () => ({
          status: "reverted",
          transactionHash: "0x" + "cd".repeat(32),
          blockNumber: 999n,
        })),
      }),
      merchantAccountAddress: MERCHANT,
    });
    const failed = await failedAdapter.reconcilePayment("0x" + "cd".repeat(32));
    expect(failed).toMatchObject({
      status: "failed",
      reasonCode: "transaction_reverted",
    });
  });

  it("classifyProtocolError and decodeRevertSelector map observed failures", () => {
    expect(decodeRevertSelector("0x8a9e71ea")).toBe("spending_limit_exceeded");
    expect(decodeRevertSelector("0x576b38b4")).toBe("call_not_allowed");
    expect(decodeRevertSelector(null)).toBeNull();

    const err = new Error("x") as Error & { cause?: unknown };
    err.cause = {
      message:
        "Revm error: keychain validation failed: AccountKeychainError(KeyExpired(KeyExpired))",
    };
    expect(classifyProtocolError(err)).toBe("key_expired");

    expect(classifyProtocolError(new Error("connection reset"))).toBeNull();
  });

  it("the adapter surface satisfies the frozen TempoAdapter contract", () => {
    const adapter: TempoAdapter = createTempoAdapter(CONFIG, {
      client: fakeClient(),
      merchantAccountAddress: MERCHANT,
    });
    expect(adapter.implementation).toBe("live");
  });
});
