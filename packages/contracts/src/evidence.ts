import { z } from "zod";

/**
 * The two evidence modes must never be silently combined. Every snapshot,
 * offer, score, and dashboard surface carries one of these:
 *
 * - synthetic_fixture: deterministic simulated history (may include simulated
 *   days). Never claimed as operating history.
 * - observed_testnet: real testnet transactions ingested from the chain.
 *   Makes no claim about genuine merchant sales.
 */
export const evidenceModeSchema = z.enum([
  "synthetic_fixture",
  "observed_testnet",
]);
export type EvidenceMode = z.infer<typeof evidenceModeSchema>;

export const EVIDENCE_MODE_LABEL: Record<EvidenceMode, string> = {
  synthetic_fixture: "Synthetic fixture (simulated history)",
  observed_testnet:
    "Observed testnet activity (real transactions, not verified sales)",
};

/** Human-visible label required on any UI surface that renders evidence-derived data. */
export const evidenceLabelSchema = z.object({
  mode: evidenceModeSchema,
  detail: z.string().min(1),
});
export type EvidenceLabel = z.infer<typeof evidenceLabelSchema>;
