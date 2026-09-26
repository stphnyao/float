import {
  parseMoneyAmount,
  transferEventSchema,
  type EventReference,
  type HexAddress,
  type MoneyAmount,
  type TransferEvent,
} from "@float/contracts";
import { POLICY_VERSION, type PolicyReasonCode } from "./version.js";

/**
 * Event classification (docs/policy-v1.md section 3). Rules are evaluated in
 * the frozen priority order; the first match wins. Classification is
 * deterministic: events are processed in sorted order
 * (timestampSec, blockNumber, logIndex, txHash) and results do not depend on
 * the input batch order.
 */

export interface ClassificationContext {
  chainId: number;
  /** Merchant wallet that receives sales (ingestion scope). */
  merchantAddress: HexAddress;
  /** The single tracked TIP-20 token; other tokens are not receipts. */
  tokenAddress: HexAddress;
  /** Float treasury: disbursements FROM this sender are not revenue. */
  treasuryAddress: HexAddress;
  /** Faucet distribution senders. */
  faucetSenders: HexAddress[];
  /** Addresses declared merchant-controlled (self-funding). */
  knownSelfFundingSources: HexAddress[];
  /** Identified non-sale senders (grants, platform credits, ...). */
  knownNonSaleSenders: HexAddress[];
  /** Payers already classified eligible in earlier batches (for refunds). */
  priorIncludedPayers: HexAddress[];
  /** Event references classified in earlier batches (duplicate detection). */
  seenEventRefs: EventReference[];
}

export type ClassificationOutcome = "included" | "excluded" | "adjustment";

export interface ClassifiedEvent {
  ref: EventReference;
  outcome: ClassificationOutcome;
  reasonCode: PolicyReasonCode;
  /** Deterministic explanation naming the matched rule/address/reference. */
  provenance: string;
  from: HexAddress;
  to: HexAddress;
  timestampSec: number;
  amountBaseUnits: MoneyAmount;
  classificationVersion: string;
}

export interface ClassificationResult {
  classificationVersion: string;
  /** Sorted in the deterministic processing order. */
  events: ClassifiedEvent[];
}

/** Stable identity key for an event reference. */
export function eventRefKey(ref: EventReference): string {
  return `${ref.chainId}:${ref.txHash}:${ref.logIndex}`;
}

function compareEvents(a: TransferEvent, b: TransferEvent): number {
  if (a.timestampSec !== b.timestampSec) return a.timestampSec - b.timestampSec;
  if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  if (a.txHash !== b.txHash) return a.txHash < b.txHash ? -1 : 1;
  return 0;
}

function classifyOne(
  event: TransferEvent,
  context: ClassificationContext,
  seenKeys: Set<string>,
  circularPayers: ReadonlySet<string>,
  eligiblePayers: Set<string>,
): ClassifiedEvent {
  const ref: EventReference = {
    chainId: event.chainId,
    txHash: event.txHash,
    logIndex: event.logIndex,
  };
  const key = eventRefKey(ref);
  const amount = parseMoneyAmount(event.amountBaseUnits);
  const base = {
    ref,
    from: event.from,
    to: event.to,
    timestampSec: event.timestampSec,
    amountBaseUnits: event.amountBaseUnits,
    classificationVersion: POLICY_VERSION,
  };

  const result = (
    outcome: ClassificationOutcome,
    reasonCode: PolicyReasonCode,
    provenance: string,
  ): ClassifiedEvent => ({ ...base, outcome, reasonCode, provenance });

  // 1. duplicate identity (chainId, txHash, logIndex)
  if (seenKeys.has(key)) {
    return result(
      "excluded",
      "policy_excluded_duplicate_event",
      `duplicate identity ${key} already classified`,
    );
  }
  seenKeys.add(key);

  // 2. untracked token
  if (event.tokenAddress !== context.tokenAddress) {
    return result(
      "excluded",
      "policy_excluded_untracked_token",
      `token ${event.tokenAddress} is not tracked token ${context.tokenAddress}`,
    );
  }

  // 3. merchant is not a party
  if (
    event.from !== context.merchantAddress &&
    event.to !== context.merchantAddress
  ) {
    return result(
      "excluded",
      "policy_excluded_unrelated_transfer",
      `neither from ${event.from} nor to ${event.to} is the merchant`,
    );
  }

  // 4. self-transfer
  if (event.from === event.to) {
    return result(
      "excluded",
      "policy_excluded_self_transfer",
      `self-transfer on address ${event.from}`,
    );
  }

  // 5. faucet distribution
  if (context.faucetSenders.includes(event.from)) {
    return result(
      "excluded",
      "policy_excluded_faucet_distribution",
      `sender ${event.from} is a faucet sender`,
    );
  }

  // 6. Float disbursement (recognizable treasury sender)
  if (event.from === context.treasuryAddress) {
    return result(
      "excluded",
      "policy_excluded_float_disbursement",
      `sender ${event.from} is the Float treasury`,
    );
  }

  // 7. known self-funding source
  if (context.knownSelfFundingSources.includes(event.from)) {
    return result(
      "excluded",
      "policy_excluded_known_self_funding",
      `sender ${event.from} is a known self-funding source`,
    );
  }

  // 8. identified non-sale sender (checked before the negative-amount branch
  // so a listed non-sale sender is never treated as a refund payer)
  if (context.knownNonSaleSenders.includes(event.from)) {
    return result(
      "excluded",
      "policy_excluded_identified_non_sale",
      `sender ${event.from} is an identified non-sale sender`,
    );
  }

  // 8/9. negative amounts: refund adjustments vs identified non-sales
  if (amount < 0n) {
    if (eligiblePayers.has(event.from)) {
      return result(
        "adjustment",
        "policy_adjustment_refund",
        `refund of ${event.amountBaseUnits} from eligible payer ${event.from}; applied append-only to a later unprocessed window`,
      );
    }
    return result(
      "excluded",
      "policy_excluded_identified_non_sale",
      `negative amount ${event.amountBaseUnits} without a matching eligible payer (${event.from})`,
    );
  }

  // 10. outgoing transfer from the merchant
  if (event.from === context.merchantAddress) {
    return result(
      "excluded",
      "policy_excluded_outgoing_transfer",
      `outgoing transfer from merchant to ${event.to} is never a receipt`,
    );
  }

  // 11. suspected circular payer (received an outgoing merchant transfer in this batch)
  if (circularPayers.has(event.from)) {
    return result(
      "excluded",
      "policy_excluded_suspected_circular",
      `sender ${event.from} also received an outgoing transfer from the merchant in this batch (suspected circular flow, labeled conservatively)`,
    );
  }

  // 12. eligible sale
  eligiblePayers.add(event.from);
  return result(
    "included",
    "policy_included_eligible_sale",
    `sale from payer ${event.from}`,
  );
}

export function classifyEvents(
  events: TransferEvent[],
  context: ClassificationContext,
): ClassificationResult {
  // Validate every raw event against the frozen contract before classifying.
  const validated = events.map((event) => transferEventSchema.parse(event));
  const sorted = [...validated].sort(compareEvents);

  // Batch-level circular-payer set: recipients of outgoing merchant transfers.
  // Computed over the whole batch so results are input-order independent.
  const circularPayers = new Set<string>();
  for (const event of sorted) {
    if (
      event.from === context.merchantAddress &&
      event.to !== context.merchantAddress
    ) {
      circularPayers.add(event.to);
    }
  }

  const seenKeys = new Set(context.seenEventRefs.map(eventRefKey));
  const eligiblePayers = new Set<string>(context.priorIncludedPayers);

  const classified = sorted.map((event) =>
    classifyOne(event, context, seenKeys, circularPayers, eligiblePayers),
  );

  return { classificationVersion: POLICY_VERSION, events: classified };
}
