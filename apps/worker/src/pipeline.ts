import type {
  EventReference,
  EvidenceMode,
  TransferEvent,
} from "@float/contracts";
import type { ScanCoverage } from "@float/db";
import {
  buildRevenueSnapshots,
  classifyEvents,
  type ClassifiedEvent,
} from "@float/policy";

/**
 * The classification integration point (work package seam). The worker never
 * imports policy rules directly into its money paths: it depends on THIS
 * interface, and tests inject a stub classifier to prove exclusion behavior
 * (refunds, self-transfers, float disbursements) is purely a pipeline
 * property. The default implementation is policy v1 (packages/policy).
 */
export interface PipelineClassifiedEvent {
  ref: EventReference;
  outcome: "included" | "excluded" | "adjustment";
  reasonCode: string;
  /** Deterministic explanation naming the matched rule/addresses. */
  provenance: string;
  timestampSec: number;
  /** Signed integer base units (negative = canonical refund adjustment). */
  amountBaseUnits: string;
}

export interface PipelineSnapshot {
  /** Deterministic pipeline id (uuid-shaped). First freeze wins. */
  id: string;
  windowStartSec: number;
  windowEndSec: number;
  /** Signed integer base units string. */
  netEligibleAmount: string;
  completeness: "complete" | "incomplete";
  completenessNotes: string;
  includedEvents: EventReference[];
  excludedEvents: { ref: EventReference; reasonCode: string }[];
  /** Every classified event bucketed into this window. */
  events: PipelineClassifiedEvent[];
}

export interface BuildSnapshotsRequest {
  merchantId: string;
  /** Period anchor = funding confirmation time (PLAN section 3). */
  anchorSec: number;
  nowSec: number;
  periodSeconds: number;
  coverage: ScanCoverage | null;
  /** Frozen window starts that must never be rewritten. */
  settledWindowStartsSec: number[];
  events: TransferEvent[];
}

export interface DeferredAdjustmentView {
  ref: EventReference;
  amountBaseUnits: string;
  note: string;
}

export interface ReceiptPipeline {
  readonly classificationVersion: string;
  readonly evidenceMode: EvidenceMode;
  classify(events: TransferEvent[]): PipelineClassifiedEvent[];
  buildSnapshots(request: BuildSnapshotsRequest): {
    snapshots: PipelineSnapshot[];
    deferredAdjustments: DeferredAdjustmentView[];
  };
}

/**
 * Default pipeline backed by policy v1. `merchantAddress` is the ingestion
 * scope; `treasuryAddress` marks Float disbursements; negative-amount events
 * are canonical refund adjustments (adapter-normalized).
 */
export function policyReceiptPipeline(opts: {
  chainId: number;
  merchantAddress: string;
  treasuryAddress: string;
  tokenAddress: string;
  faucetSenders: string[];
  knownSelfFundingSources: string[];
  knownNonSaleSenders: string[];
  evidenceMode: EvidenceMode;
}): ReceiptPipeline {
  const classificationVersion = "policy-v1";
  function context() {
    return {
      chainId: opts.chainId,
      merchantAddress: opts.merchantAddress,
      tokenAddress: opts.tokenAddress,
      treasuryAddress: opts.treasuryAddress,
      faucetSenders: opts.faucetSenders,
      knownSelfFundingSources: opts.knownSelfFundingSources,
      knownNonSaleSenders: opts.knownNonSaleSenders,
      // Reclassifying the merchant's full history each run keeps the batch
      // self-consistent (a sale and its refund land in the same batch), so
      // no cross-batch continuity inputs are needed.
      priorIncludedPayers: [],
      seenEventRefs: [],
    };
  }

  function toView(event: ClassifiedEvent): PipelineClassifiedEvent {
    return {
      ref: event.ref,
      outcome: event.outcome,
      reasonCode: event.reasonCode,
      provenance: event.provenance,
      timestampSec: event.timestampSec,
      amountBaseUnits: event.amountBaseUnits,
    };
  }

  return {
    classificationVersion,
    evidenceMode: opts.evidenceMode,
    classify(events: TransferEvent[]): PipelineClassifiedEvent[] {
      return classifyEvents(events, context()).events.map(toView);
    },
    buildSnapshots(request: BuildSnapshotsRequest) {
      const classified = classifyEvents(request.events, context());
      const built = buildRevenueSnapshots(classified, {
        merchantId: request.merchantId,
        chainId: opts.chainId,
        evidenceMode: opts.evidenceMode,
        anchorSec: request.anchorSec,
        nowSec: request.nowSec,
        periodSeconds: request.periodSeconds,
        scanCoverage: request.coverage
          ? [
              {
                startSec: request.coverage.startSec,
                endSec: request.coverage.endSec,
              },
            ]
          : [],
        settledWindowStartsSec: request.settledWindowStartsSec,
      });
      // Bucket classified events by window so persisted classifications
      // line up with the frozen snapshots.
      const byWindow = new Map<number, PipelineClassifiedEvent[]>();
      for (const event of classified.events) {
        const k = Math.floor(
          (event.timestampSec - request.anchorSec) / request.periodSeconds,
        );
        const bucket = byWindow.get(k);
        if (bucket) bucket.push(toView(event));
        else byWindow.set(k, [toView(event)]);
      }
      return {
        snapshots: built.snapshots.map((snapshot) => {
          const k = Math.floor(
            (snapshot.window.startSec - request.anchorSec) /
              request.periodSeconds,
          );
          return {
            id: snapshot.id,
            windowStartSec: snapshot.window.startSec,
            windowEndSec: snapshot.window.endSec,
            netEligibleAmount: snapshot.netEligibleAmount,
            completeness: snapshot.completeness,
            completenessNotes: snapshot.completenessNotes,
            includedEvents: snapshot.includedEvents,
            excludedEvents: snapshot.excludedEvents,
            events: byWindow.get(k) ?? [],
          };
        }),
        deferredAdjustments: built.deferredAdjustments.map((d) => ({
          ref: d.ref,
          amountBaseUnits: d.amountBaseUnits,
          note: d.note,
        })),
      };
    },
  };
}
