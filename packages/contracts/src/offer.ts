import { z } from "zod";
import { evidenceModeSchema } from "./evidence.js";
import {
  hexAddressSchema,
  moneyAmountSchema,
  basisPointsSchema,
  tokenRefSchema,
} from "./money.js";
import { offerStateSchema } from "./states.js";

/**
 * Immutable offer terms. For the demo v1 the obligation equals principal
 * (principal-only repayment); any future fee changes terms and accounting
 * tests together. All amounts are integer base-unit strings.
 */
export const offerTermsSchema = z.object({
  token: tokenRefSchema,
  treasuryAddress: hexAddressSchema,
  principalAmount: moneyAmountSchema,
  totalObligationAmount: moneyAmountSchema,
  collectionRateBps: basisPointsSchema,
  periodCeilingAmount: moneyAmountSchema,
  /** Normal periods are 86,400 seconds anchored to authorization time. */
  periodSeconds: z.number().int().positive(),
  authorizationExpirySec: z.number().int(),
  estimatedCollectionHorizonSec: z.number().int().positive(),
  /** Absolute demo maximum on principal (policy input). */
  maxPrincipalAmount: moneyAmountSchema,
  /** Haircut applied to collection capacity when sizing principal (policy input). */
  sizingHaircutBps: basisPointsSchema,
});
export type OfferTerms = z.infer<typeof offerTermsSchema>;

export const offerDecisionSchema = z.enum([
  "eligible",
  "declined",
  "insufficient_evidence",
]);
export type OfferDecision = z.infer<typeof offerDecisionSchema>;

/**
 * A rendered offer. termsHash binds acceptance to the exact terms; the
 * evidence label must be surfaced wherever the offer is displayed.
 */
export const offerSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().uuid(),
  terms: offerTermsSchema,
  termsHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  policyVersion: z.string().min(1),
  snapshotIds: z.array(z.string().uuid()),
  decision: offerDecisionSchema,
  reasonCodes: z.array(z.string()).min(1),
  evidenceMode: evidenceModeSchema,
  state: offerStateSchema,
  expiresAtSec: z.number().int(),
  createdAtSec: z.number().int(),
});
export type Offer = z.infer<typeof offerSchema>;

/**
 * Deterministic serialization used for terms hashing. Object keys are sorted
 * recursively; arrays keep order; numbers must be integers. The hash itself
 * (sha256 of the UTF-8 bytes, hex-encoded) is computed by the server, since
 * contracts stays runtime-agnostic.
 */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  function serialize(node: unknown): string {
    if (node === null || typeof node === "string") return JSON.stringify(node);
    if (typeof node === "number") {
      if (!Number.isInteger(node))
        throw new Error("canonicalJson: floats are not allowed");
      return JSON.stringify(node);
    }
    if (typeof node === "boolean") return JSON.stringify(node);
    if (typeof node === "bigint") return node.toString(10);
    if (Array.isArray(node)) return `[${node.map(serialize).join(",")}]`;
    if (typeof node === "object") {
      if (seen.has(node)) throw new Error("canonicalJson: circular reference");
      seen.add(node);
      const entries = Object.entries(node as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(",")}}`;
    }
    throw new Error(`canonicalJson: unsupported value ${String(node)}`);
  }
  return serialize(value);
}
