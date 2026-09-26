import { toFunctionSelector } from "viem";

/**
 * Decoded protocol error mapping for Tempo access-key enforcement.
 *
 * Evidence status (spike 2026-09-26, viem 2.56.9, node tempo/v1.15.0-464e519):
 * - SpendingLimitExceeded(): raw revert selector `0x8a9e71ea` OBSERVED on
 *   testnet during the cumulative-ceiling test (spike/evidence/04-ceiling.json).
 * - CallNotAllowed(): raw revert selector `0x576b38b4` OBSERVED on testnet
 *   during the scope tests (spike/evidence/05-scopes.json).
 * - KeyExpired(): error NAME observed in revert reason text
 *   (spike/evidence/06-expiry-revoke.json); raw selector not observed because
 *   the node surfaced the reason as text, so the selector here is derived from
 *   the signature, not captured from the wire.
 * - KeyAlreadyRevoked(): same status as KeyExpired().
 */
export const KNOWN_REVERT_SELECTORS: Record<
  string,
  { code: string; description: string }
> = {
  [toFunctionSelector("SpendingLimitExceeded()")]: {
    code: "spending_limit_exceeded",
    description:
      "Access-key per-token recurring spending limit exceeded (TIP-1011).",
  },
  [toFunctionSelector("CallNotAllowed()")]: {
    code: "call_not_allowed",
    description:
      "Call violates the access-key scopes (contract/selector/recipient).",
  },
  [toFunctionSelector("KeyExpired()")]: {
    code: "key_expired",
    description: "Access key is past its expiry timestamp.",
  },
  [toFunctionSelector("KeyAlreadyRevoked()")]: {
    code: "key_revoked",
    description: "Access key has been revoked on-chain.",
  },
};

/** Protocol error names that appear inside revert reason TEXT (observed on testnet). */
const KNOWN_ERROR_TEXT: { match: RegExp; code: string }[] = [
  { match: /SpendingLimitExceeded/, code: "spending_limit_exceeded" },
  { match: /CallNotAllowed/, code: "call_not_allowed" },
  { match: /KeyExpired/, code: "key_expired" },
  { match: /KeyAlreadyRevoked/, code: "key_revoked" },
];

/** Map raw revert data (0x-prefixed) to a stable reason code, or null. */
export function decodeRevertSelector(
  data: string | null | undefined,
): string | null {
  if (!data || !data.startsWith("0x") || data.length < 10) return null;
  const entry = KNOWN_REVERT_SELECTORS[data.slice(0, 10).toLowerCase()];
  return entry?.code ?? null;
}

/**
 * Best-effort stable reason code from any thrown error: inspects raw revert
 * data and viem's error-cause chain. Returns "unknown_protocol_error" when
 * the failure is a chain rejection we cannot classify, null when the error
 * does not look like a protocol rejection at all.
 */
export function classifyProtocolError(err: unknown): string | null {
  let cur: unknown = err;
  let sawRevert = false;
  for (let depth = 0; depth < 10 && cur && typeof cur === "object"; depth++) {
    const e = cur as {
      message?: string;
      data?: unknown;
      raw?: unknown;
      signature?: unknown;
      cause?: unknown;
    };
    const rawCandidates = [e.data, e.raw, e.signature];
    for (const raw of rawCandidates) {
      if (typeof raw === "string" && /^0x[0-9a-fA-F]{8}/.test(raw)) {
        sawRevert = true;
        const code = decodeRevertSelector(raw);
        if (code) return code;
      }
    }
    const message = e.message ?? "";
    for (const { match, code } of KNOWN_ERROR_TEXT) {
      if (match.test(message)) return code;
    }
    if (/Execution reverted|revert/i.test(message)) sawRevert = true;
    cur = e.cause;
  }
  return sawRevert ? "unknown_protocol_error" : null;
}

/** Thrown when the RPC reports a chainId different from the configured one. */
export class TempoChainMismatchError extends Error {
  readonly expectedChainId: number;
  readonly observedChainId: number;
  constructor(expectedChainId: number, observedChainId: number) {
    super(
      `chain mismatch: RPC reports chainId ${observedChainId}, expected ${expectedChainId}. Refusing all reads/writes.`,
    );
    this.name = "TempoChainMismatchError";
    this.expectedChainId = expectedChainId;
    this.observedChainId = observedChainId;
  }
}

/** Thrown when a preflight/estimation rejects the payment (no receipt exists). */
export class TempoPreflightRejectionError extends Error {
  readonly reasonCode: string;
  readonly revertData: string | null;
  constructor(reasonCode: string, detail: string, revertData: string | null) {
    super(`preflight rejection (${reasonCode}): ${detail}`);
    this.name = "TempoPreflightRejectionError";
    this.reasonCode = reasonCode;
    this.revertData = revertData;
  }
}
