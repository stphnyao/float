import { createHash } from "node:crypto";
import {
  UnresolvedSubmitError,
  type Authorization,
  type AuthorizationRead,
  type IngestionCursor,
  type PaymentIntent,
  type PaymentOutcome,
  type TempoAdapter,
  type TransferEvent,
} from "@float/contracts";

/**
 * FakeTempoAdapter — the ONLY chain implementation used by the integration
 * tests (PLAN section 7: "Default CI uses fakes/local resources"). It
 * implements the frozen TempoAdapter interface and sets
 * `implementation: "fake"` as a const: a fake can never generate evidence
 * that looks like live-chain data, and every test suite asserts that flag.
 *
 * Scripted behaviors: success, definitive protocol failure (decoded error),
 * timeout AFTER broadcast (outcome unknown, txHash known), timeout BEFORE
 * broadcast (no txHash). Re-submission of the same intent is modeled as
 * nonce-safe: the same idempotency key always maps to the same txHash —
 * the property the live adapter must reproduce for crash recovery.
 */

export class FakeProtocolError extends Error {
  /** Decoded protocol-level reason (e.g. AccessKeyLimitExceeded). */
  readonly protocolReason: string;
  constructor(protocolReason: string, detail?: string) {
    super(detail ?? `fake protocol rejection: ${protocolReason}`);
    this.name = "FakeProtocolError";
    this.protocolReason = protocolReason;
  }
}

export type SubmitScriptStep =
  | "success"
  | "timeout-after-broadcast"
  | "timeout-before-broadcast"
  | "protocol-failure";

export interface FakeLedgerEvent {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  timestampSec: number;
  from: string;
  to: string;
  tokenAddress: string;
  amountBaseUnits: string;
}

export const FAKE_FEE_TOKEN = `0x${"fee".padStart(40, "0")}` as const;

export class FakeTempoAdapter implements TempoAdapter {
  readonly implementation = "fake" as const;
  readonly chainId: number;
  private events: FakeLedgerEvent[] = [];
  private headBlock = 0;
  private submitScript: SubmitScriptStep[] = [];
  private reconcileOutcomes = new Map<string, PaymentOutcome | "pending">();
  private authReads: AuthorizationRead[] = [];
  private authReadsByKey = new Map<string, AuthorizationRead[]>();
  private balances = new Map<string, string>();
  /** Broadcast calls observed by the fake (for assertions). */
  readonly submittedBroadcasts: {
    intentIdempotencyKey: string;
    amount: string;
    from: string;
    to: string;
    txHash: string;
  }[] = [];
  /** Injectable clock for confirmedAtSec. */
  nowSec: () => number = () => Math.floor(Date.now() / 1000);

  constructor(chainId = 42431) {
    this.chainId = chainId;
  }

  // ----- scripting surface (test-only) ------------------------------------

  setLedger(events: FakeLedgerEvent[]): void {
    this.events = [...events];
    this.headBlock = this.events.reduce(
      (max, e) => Math.max(max, e.blockNumber),
      0,
    );
  }

  addEvent(event: FakeLedgerEvent): void {
    this.events.push(event);
    this.headBlock = Math.max(this.headBlock, event.blockNumber);
  }

  setSubmitScript(steps: SubmitScriptStep[]): void {
    this.submitScript = [...steps];
  }

  setReconcileOutcome(
    txHash: string,
    outcome: PaymentOutcome | "pending",
  ): void {
    this.reconcileOutcomes.set(txHash, outcome);
  }

  /**
   * Queued authorization reads. Without a keyAddress the queue applies to
   * every key; with a keyAddress it applies only to that delegated key so
   * tests can script different merchants independently.
   */
  setAuthorizationReads(reads: AuthorizationRead[], keyAddress?: string): void {
    if (keyAddress) {
      this.authReadsByKey.set(keyAddress, [...reads]);
    } else {
      this.authReads = [...reads];
    }
  }

  setBalance(account: string, tokenAddress: string, amount: string): void {
    this.balances.set(`${account}:${tokenAddress}`, amount);
  }

  broadcastCountFor(idempotencyKey: string): number {
    return this.submittedBroadcasts.filter(
      (b) => b.intentIdempotencyKey === idempotencyKey,
    ).length;
  }

  // ----- TempoAdapter ------------------------------------------------------

  async verifyNetwork(): Promise<{ chainId: number }> {
    return { chainId: this.chainId };
  }

  async getTokenInfo(tokenAddress: string): Promise<{
    address: string;
    symbol: string;
    decimals: number;
    name: string;
  }> {
    return {
      address: tokenAddress,
      symbol: "FAKEUSD",
      decimals: 6,
      name: "Fake TIP-20 token (6 decimals, test-only)",
    };
  }

  async readAuthorization(
    authorization: Authorization,
  ): Promise<AuthorizationRead> {
    const keyed = this.authReadsByKey.get(authorization.keyAddress);
    const queue = keyed ?? this.authReads;
    const next = queue.shift();
    if (next) {
      if (keyed && queue.length === 0)
        this.authReadsByKey.delete(authorization.keyAddress);
      return next;
    }
    return {
      state: "valid",
      remainingPeriodAllowance: "1000000000",
      currentPeriodEndSec: null,
      expirySec: authorization.expirySec,
    };
  }

  async getBalance(account: string, tokenAddress: string): Promise<string> {
    return this.balances.get(`${account}:${tokenAddress}`) ?? "1000000000";
  }

  async ingestTransfers(
    cursor: IngestionCursor,
    filter: { tokenAddress: string; recipients?: string[]; senders?: string[] },
  ): Promise<{ events: TransferEvent[]; nextCursor: IngestionCursor }> {
    const matching = this.events.filter(
      (event) =>
        event.blockNumber >= cursor.nextBlockNumber &&
        event.tokenAddress === filter.tokenAddress &&
        ((filter.recipients?.includes(event.to) ?? false) ||
          (filter.senders?.includes(event.from) ?? false)),
    );
    const normalized: TransferEvent[] = matching.map((event) => {
      if (filter.senders) {
        // Refund pass: on-chain refunds leave the merchant, so they are
        // normalized to negative-amount events with the payer as sender
        // (canonical refund representation, same as fixtures/helpers.ts).
        return {
          chainId: this.chainId,
          txHash: event.txHash,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          blockHash: event.blockHash,
          timestampSec: event.timestampSec,
          from: event.to,
          to: event.from,
          tokenAddress: event.tokenAddress,
          amountBaseUnits: (-BigInt(event.amountBaseUnits)).toString(10),
        };
      }
      return {
        chainId: this.chainId,
        txHash: event.txHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        blockHash: event.blockHash,
        timestampSec: event.timestampSec,
        from: event.from,
        to: event.to,
        tokenAddress: event.tokenAddress,
        amountBaseUnits: event.amountBaseUnits,
      };
    });
    return {
      events: normalized,
      nextCursor: {
        chainId: this.chainId,
        nextBlockNumber: this.headBlock + 1,
      },
    };
  }

  async preparePayment(): Promise<{
    prepared: true;
    estimatedFeeAmount: string | null;
    feeToken: string | null;
  }> {
    // Fees ride in a separate fee token and are tracked separately from
    // principal (PLAN section 3); the fake reports a constant estimate.
    return {
      prepared: true,
      estimatedFeeAmount: "1000",
      feeToken: FAKE_FEE_TOKEN,
    };
  }

  async submitPayment(prepareRef: {
    intent: PaymentIntent;
    from: string;
    to: string;
    tokenAddress: string;
  }): Promise<{ txHash: string }> {
    const step = this.submitScript.shift() ?? "success";
    // Nonce-safe re-submission: the same intent key always maps to the same
    // transaction identity (the live adapter must reproduce this).
    const txHash = `0x${createHash("sha256")
      .update(`float-fake-tx:${prepareRef.intent.idempotencyKey}`)
      .digest("hex")}`;
    if (step === "success" || step === "timeout-after-broadcast") {
      // Only these steps actually reached the chain.
      this.submittedBroadcasts.push({
        intentIdempotencyKey: prepareRef.intent.idempotencyKey,
        amount: prepareRef.intent.amount,
        from: prepareRef.from,
        to: prepareRef.to,
        txHash,
      });
    }
    switch (step) {
      case "success":
        return { txHash };
      case "timeout-after-broadcast":
        // Broadcast accepted, response lost: outcome genuinely unknown.
        throw new UnresolvedSubmitError(
          "fake rpc timeout after broadcast",
          txHash,
        );
      case "timeout-before-broadcast":
        // Connection died before the RPC accepted: no tx identity exists.
        throw new UnresolvedSubmitError("fake connection refused", null);
      case "protocol-failure":
        throw new FakeProtocolError(
          "AccessKeyLimitExceeded",
          "fake cumulative period limit exceeded on-chain",
        );
    }
  }

  async reconcilePayment(txHash: string): Promise<PaymentOutcome> {
    const scripted = this.reconcileOutcomes.get(txHash);
    if (scripted === "pending") return { status: "pending" };
    if (scripted) return scripted;
    return {
      status: "confirmed",
      txHash,
      blockNumber: this.headBlock + 10,
      confirmedAtSec: this.nowSec(),
      feeAmount: "1000",
      feeToken: FAKE_FEE_TOKEN,
    };
  }
}

/** Deterministic fake-ledger event builder (unique tx per call). */
let fakeEventCounter = 0;
export function fakeEvent(
  input: Partial<FakeLedgerEvent> & {
    timestampSec: number;
    from: string;
    to: string;
    amountBaseUnits: string;
    tokenAddress: string;
  },
): FakeLedgerEvent {
  fakeEventCounter += 1;
  return {
    txHash: `0x${createHash("sha256")
      .update(
        `float-fake-event:${fakeEventCounter}:${input.timestampSec}:${input.from}:${input.amountBaseUnits}`,
      )
      .digest("hex")}`,
    logIndex: 0,
    blockNumber: fakeEventCounter,
    blockHash: `0x${"b".repeat(64)}`,
    ...input,
  };
}
