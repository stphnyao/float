import { REASON_CODES, type ReasonCode } from "@float/contracts";

/**
 * Typed repository errors. `code` is always a stable reason code from
 * @float/contracts — callers branch on the code, never on message text.
 * These errors carry NO financial mutation: they are thrown from
 * transactions that roll back (or from pre-checks before any write).
 */
export class LedgerError extends Error {
  readonly code: ReasonCode;
  constructor(code: ReasonCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export function assertReasonCode(code: string): ReasonCode {
  if ((REASON_CODES as readonly string[]).includes(code)) {
    return code as ReasonCode;
  }
  return "INTERNAL_UNEXPECTED";
}

/**
 * True when the error (or its wrapped cause chain — drizzle wraps driver
 * errors) is a unique-index violation for `indexName`.
 */
export function isUniqueViolation(err: unknown, indexName: string): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object") {
      const pgErr = current as {
        code?: string;
        constraint?: string;
        cause?: unknown;
      };
      if (
        pgErr.code === "23505" &&
        (pgErr.constraint === indexName ||
          (pgErr.constraint ?? "").includes(indexName))
      ) {
        return true;
      }
      current = pgErr.cause;
    } else {
      break;
    }
  }
  return false;
}
