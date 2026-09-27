import { createHash } from "node:crypto";
import type { EventReference, TransferEvent } from "@float/contracts";
import type {
  BuildSnapshotsRequest,
  PipelineClassifiedEvent,
  PipelineSnapshot,
  ReceiptPipeline,
} from "@float/worker";

/**
 * Stub classifier for the classification-integration-point tests (G3 matrix:
 * refund / self-transfer / float-disbursement exclusion). It implements the
 * SAME ReceiptPipeline seam the worker uses for policy v1, proving the money
 * paths depend on the seam — not on a specific classifier. Rules here are
 * deliberately simple and independent of packages/policy:
 *
 *   1. duplicate identity (within this pipeline instance)
 *   2. untracked token
 *   3. self-transfer (from === to)
 *   4. float disbursement (from === treasury)
 *   5. negative amount from a payer with a prior included sale => refund
 *      adjustment (applied to the same window it appears in — a stub-level
 *      simplification; policy v1 defers refunds to a LATER unprocessed
 *      window)
 *   6. outgoing transfer from the merchant
 *   7. otherwise eligible sale
 *
 * Snapshots are simple window aggregations with coverage-based completeness.
 */
export function stubPipeline(opts: {
  chainId: number;
  merchantAddress: string;
  treasuryAddress: string;
  tokenAddress: string;
}): ReceiptPipeline {
  const classificationVersion = "stub-v1";
  const seen = new Set<string>();

  function classify(events: TransferEvent[]): PipelineClassifiedEvent[] {
    const eligiblePayers = new Set<string>();
    const rows: PipelineClassifiedEvent[] = [];
    for (const event of events) {
      const ref: EventReference = {
        chainId: event.chainId,
        txHash: event.txHash,
        logIndex: event.logIndex,
      };
      const key = `${ref.chainId}:${ref.txHash}:${ref.logIndex}`;
      const base = {
        ref,
        timestampSec: event.timestampSec,
        amountBaseUnits: event.amountBaseUnits,
        classificationVersion,
      };
      const make = (
        outcome: PipelineClassifiedEvent["outcome"],
        reasonCode: string,
        provenance: string,
      ): PipelineClassifiedEvent => ({
        ...base,
        outcome,
        reasonCode,
        provenance,
      });

      if (seen.has(key)) {
        rows.push(
          make("excluded", "stub_excluded_duplicate", `duplicate ${key}`),
        );
        continue;
      }
      seen.add(key);
      if (event.tokenAddress !== opts.tokenAddress) {
        rows.push(
          make(
            "excluded",
            "stub_excluded_untracked_token",
            "not the tracked token",
          ),
        );
        continue;
      }
      if (event.from === event.to) {
        rows.push(
          make(
            "excluded",
            "stub_excluded_self_transfer",
            `self-transfer ${event.from}`,
          ),
        );
        continue;
      }
      if (event.from === opts.treasuryAddress) {
        rows.push(
          make(
            "excluded",
            "stub_excluded_float_disbursement",
            `sender ${event.from} is the treasury`,
          ),
        );
        continue;
      }
      const amount = BigInt(event.amountBaseUnits);
      if (amount < 0n) {
        if (eligiblePayers.has(event.from)) {
          rows.push(
            make(
              "adjustment",
              "stub_adjustment_refund",
              `refund from ${event.from}`,
            ),
          );
          continue;
        }
        rows.push(
          make(
            "excluded",
            "stub_excluded_unmatched_refund",
            `negative without eligible payer ${event.from}`,
          ),
        );
        continue;
      }
      if (event.from === opts.merchantAddress) {
        rows.push(
          make("excluded", "stub_excluded_outgoing", "outgoing from merchant"),
        );
        continue;
      }
      eligiblePayers.add(event.from);
      rows.push(
        make("included", "stub_included_sale", `sale from ${event.from}`),
      );
    }
    return rows;
  }

  return {
    classificationVersion,
    evidenceMode: "synthetic_fixture",
    classify,
    buildSnapshots(request: BuildSnapshotsRequest) {
      const classified = classify(request.events);
      const byWindow = new Map<number, PipelineClassifiedEvent[]>();
      for (const event of classified) {
        const k = Math.floor(
          (event.timestampSec - request.anchorSec) / request.periodSeconds,
        );
        const bucket = byWindow.get(k);
        if (bucket) bucket.push(event);
        else byWindow.set(k, [event]);
      }
      const snapshots: PipelineSnapshot[] = [];
      const kCompletedMax =
        Math.floor(
          (request.nowSec - request.anchorSec) / request.periodSeconds,
        ) - 1;
      for (const [k, events] of [...byWindow.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        if (k < 0 || k > kCompletedMax) continue;
        if (
          request.settledWindowStartsSec.includes(
            request.anchorSec + k * request.periodSeconds,
          )
        ) {
          continue;
        }
        let net = 0n;
        for (const event of events) {
          if (event.outcome === "included" || event.outcome === "adjustment") {
            net += BigInt(event.amountBaseUnits);
          }
        }
        const windowStartSec = request.anchorSec + k * request.periodSeconds;
        const windowEndSec = windowStartSec + request.periodSeconds;
        const complete =
          request.coverage !== null &&
          request.coverage.startSec <= windowStartSec &&
          request.coverage.endSec >= windowEndSec;
        // Deterministic, globally-unique snapshot id (merchant-scoped): the
        // revenue_snapshots primary key is the pipeline id itself.
        const digest = createHash("sha256")
          .update(`${opts.merchantAddress}:${windowStartSec}:${net.toString()}`)
          .digest("hex");
        const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
        snapshots.push({
          id,
          windowStartSec,
          windowEndSec,
          netEligibleAmount: net.toString(10),
          completeness: complete ? "complete" : "incomplete",
          completenessNotes: complete ? "" : "coverage gap",
          includedEvents: events
            .filter((e) => e.outcome === "included")
            .map((e) => e.ref),
          excludedEvents: events
            .filter((e) => e.outcome === "excluded")
            .map((e) => ({ ref: e.ref, reasonCode: e.reasonCode })),
          events,
        });
      }
      return { snapshots, deferredAdjustments: [] };
    },
  };
}
