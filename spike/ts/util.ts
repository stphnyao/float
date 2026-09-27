import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";
import type { SpikeClient } from "./config.js";
import { toFunctionSelector } from "viem";
import {
  CHAIN_ID,
  makeClient,
  RPC_URL,
  accessKeyFromPrivateKey,
} from "./config.js";
import type { Account } from "viem/tempo";

const here = dirname(fileURLToPath(import.meta.url));
export const SPIKE_DIR = join(here, "..");
export const STATE_PATH = join(SPIKE_DIR, ".state", "state.json");
export const EVIDENCE_DIR = join(SPIKE_DIR, "evidence");

export function ts(): string {
  return new Date().toISOString();
}

export function log(step: string, ...parts: unknown[]): void {
  console.log(`[${ts()}] [${step}]`, ...parts);
}

export function short(addr: string): string {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export function explorerLink(hash: string): string {
  return `https://explore.testnet.tempo.xyz/tx/${hash}`;
}

/* ------------------------------------------------------------------ */
/* Runtime state: throwaway dev wallets. NEVER committed (gitignored) */
/* and never logged. Only public addresses and hashes reach evidence. */
/* ------------------------------------------------------------------ */

export type State = {
  createdAt: string;
  merchant: { address: Address; privateKey: Hex };
  treasury: { address: Address; privateKey: Hex };
  keys: Record<
    string,
    {
      label: string;
      /** On-chain key id (derived from the P256 public key) — NOT the root address. */
      keyIdAddress: Address;
      privateKey: Hex;
      keyType: "p256";
      limitUnits: string | null;
      periodSeconds: number | null;
      expirySec: number | null;
      scope: string;
    }
  >;
  receipts: Record<string, string>;
};

export function loadState(): State {
  if (!existsSync(STATE_PATH)) {
    throw new Error(
      `state file missing at ${STATE_PATH} — run the "fund" step first (generates dev wallets)`,
    );
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
}

export function saveState(state: State): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Reconstruct a delegated access key account from gitignored state. */
export function accessKeyAccountFromState(
  state: State,
  root: Account.RootAccount,
  label: string,
): Account.AccessKeyAccount {
  const key = state.keys[label];
  if (!key) {
    throw new Error(
      `key "${label}" not found in state — run the authorize step first`,
    );
  }
  return accessKeyFromPrivateKey(key.privateKey as Hex, root);
}

/* ------------------------------------------------------------------ */
/* Evidence recording (committed; public data only)                    */
/* ------------------------------------------------------------------ */

export type EvidenceEntry = Record<string, unknown>;

/** BigInt-safe JSON: converts bigint values to strings recursively. */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

export function recordEvidence(step: string, entry: EvidenceEntry): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = join(EVIDENCE_DIR, `${step}.json`);
  let list: EvidenceEntry[] = [];
  if (existsSync(file)) {
    try {
      list = JSON.parse(readFileSync(file, "utf8")) as EvidenceEntry[];
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
  }
  list.push({
    recordedAtUtc: ts(),
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    ...(jsonSafe(entry) as EvidenceEntry),
  });
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/* ------------------------------------------------------------------ */
/* Chain guards                                                        */
/* ------------------------------------------------------------------ */

/** Reject an unexpected chain before ANY write (G1 matrix item). */
export async function assertChainId(
  client: SpikeClient,
  step: string,
): Promise<number> {
  const chainId = await client.request({ method: "eth_chainId" });
  const id = Number(chainId);
  if (id !== CHAIN_ID) {
    throw new Error(
      `[${step}] refusing to continue: RPC ${RPC_URL} reports chainId ${id}, expected ${CHAIN_ID} (verified Moderato testnet)`,
    );
  }
  return id;
}

export async function makeFreshClient(): Promise<SpikeClient> {
  const client = makeClient();
  await assertChainId(client, "client");
  return client;
}

/* ------------------------------------------------------------------ */
/* Balances and receipts                                               */
/* ------------------------------------------------------------------ */

export type BalanceSnapshot = Record<string, string>;

export async function snapshotBalances(
  client: SpikeClient,
  accounts: { label: string; address: Address }[],
  tokens: { label: string; address: Address }[],
): Promise<BalanceSnapshot> {
  const out: BalanceSnapshot = {};
  for (const a of accounts) {
    for (const t of tokens) {
      const bal = await client.token.getBalance({
        account: a.address,
        token: t.address,
      });
      out[`${a.label}:${t.label}`] = bal.amount.toString(10);
    }
  }
  return out;
}

export function diffBalances(
  before: BalanceSnapshot,
  after: BalanceSnapshot,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(before)) {
    const b = BigInt(before[key] ?? "0");
    const a = BigInt(after[key] ?? "0");
    if (b !== a)
      out[key] = `${b.toString()} -> ${a.toString()} (delta ${a - b})`;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Failure capture: honest classification of rejections                */
/* ------------------------------------------------------------------ */

export type FailureCapture = {
  kind:
    | "estimation_preflight_rejection_no_receipt"
    | "submitted_and_reverted"
    | "timeout"
    | "other";
  errorName: string;
  message: string;
  causes: { name: string; message: string }[];
  /** Raw revert data if it surfaced (0x-prefixed), else null. */
  revertData: string | null;
  /** True when revertData matches a known selector from TIP-1011 naming. */
  decoded: string | null;
  receiptStatus: string | null;
  txHash: string | null;
};

/** Function selectors relevant to access-key enforcement (TIP-1011). */
export const KNOWN_ERROR_SELECTORS: Record<string, string> = {
  [toFunctionSelector("SpendingLimitExceeded()")]:
    "SpendingLimitExceeded() (TIP-1011)",
};

export function knownErrorSelector(data: string): string | null {
  return KNOWN_ERROR_SELECTORS[data.slice(0, 10).toLowerCase()] ?? null;
}

function walkCauses(
  err: unknown,
  depth = 0,
): { name: string; message: string }[] {
  if (depth > 8 || !err || typeof err !== "object") return [];
  const e = err as { name?: string; message?: string; cause?: unknown };
  const self = {
    name: e.name ?? "(no name)",
    message: e.message ?? String(err),
  };
  const rest = walkCauses((err as { cause?: unknown }).cause, depth + 1);
  return [self, ...rest];
}

function findRevertData(err: unknown): string | null {
  let cur = err;
  for (let i = 0; i < 10 && cur && typeof cur === "object"; i++) {
    const e = cur as {
      data?: unknown;
      dataSuffix?: unknown;
      raw?: unknown;
      cause?: unknown;
    };
    for (const cand of [e.data, e.raw]) {
      if (typeof cand === "string" && cand.startsWith("0x")) return cand;
    }
    cur = e.cause;
  }
  return null;
}

function findReceiptStatus(err: unknown): string | null {
  let cur = err;
  for (let i = 0; i < 10 && cur && typeof cur === "object"; i++) {
    const e = cur as { receipt?: { status?: unknown }; cause?: unknown };
    if (e.receipt && typeof e.receipt === "object") {
      const s = (e.receipt as { status?: unknown }).status;
      if (s != null) return String(s);
    }
    cur = e.cause;
  }
  return null;
}

function findTxHash(err: unknown): string | null {
  let cur = err;
  for (let i = 0; i < 10 && cur && typeof cur === "object"; i++) {
    const e = cur as { txHash?: unknown; hash?: unknown; cause?: unknown };
    if (typeof e.txHash === "string" && e.txHash.startsWith("0x"))
      return e.txHash;
    if (typeof e.hash === "string" && e.hash.startsWith("0x")) return e.hash;
    cur = e.cause;
  }
  return null;
}

export function classifyFailure(err: unknown, label: string): FailureCapture {
  const causes = walkCauses(err);
  const names = causes.map((c) => c.name).join(" <- ");
  const messages = causes.map((c) => c.message).join(" <- ");
  const revertData = findRevertData(err);
  const receiptStatus = findReceiptStatus(err);
  const txHash = findTxHash(err);

  let kind: FailureCapture["kind"] = "other";
  if (/timed? ?out|timeout/i.test(messages)) {
    kind = "timeout";
  } else if (
    receiptStatus &&
    receiptStatus !== "0x1" &&
    receiptStatus !== "success"
  ) {
    kind = "submitted_and_reverted";
  } else if (
    /estimategas|simulate|preflight|ExecutionReverted/i.test(names + messages)
  ) {
    kind = "estimation_preflight_rejection_no_receipt";
  } else if (receiptStatus === "0x1" || receiptStatus === "success") {
    kind = "other"; // receipt succeeded but an error was thrown — unexpected
  }

  const capture: FailureCapture = {
    kind,
    errorName: causes[0]?.name ?? "(unknown)",
    message: messages.slice(0, 2000),
    causes,
    revertData,
    decoded: revertData ? knownErrorSelector(revertData) : null,
    receiptStatus,
    txHash,
  };
  log(label, "failure captured:", {
    kind: capture.kind,
    errorName: capture.errorName,
    revertData: capture.revertData,
    decoded: capture.decoded,
    receiptStatus: capture.receiptStatus,
    txHash: capture.txHash,
    firstMessages: causes
      .slice(0, 4)
      .map((c) => `${c.name}: ${c.message.slice(0, 200)}`),
  });
  return capture;
}

/** Send a write and return its receipt, or capture the failure honestly. */
export async function expectRejection(
  step: string,
  label: string,
  attempt: () => Promise<unknown>,
): Promise<FailureCapture> {
  try {
    await attempt();
  } catch (err) {
    return classifyFailure(err, label);
  }
  throw new Error(
    `[${step}] ${label}: EXPECTED REJECTION DID NOT HAPPEN — the call succeeded`,
  );
}

export async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
