import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AccessKeyScope,
  AdvanceState,
  AuthorizationState,
  BudgetStatus,
  EvidenceMode,
  ExcludedEvent,
  EventReference,
  LedgerEntryKind,
  OfferDecision,
  OfferTerms,
  PaymentIntentKind,
  PaymentIntentState,
  PaymentOutcome,
  ReservationStatus,
} from "@float/contracts";

/**
 * Amounts are Postgres bigint columns carrying token base units. Drizzle's
 * bigint mode maps them to JS bigint — never to number. States are text with
 * contract-level types; transitions are enforced by application code using
 * contracts' STATE_TRANSITIONS, except where a database constraint carries a
 * money-critical invariant.
 */

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const offers = pgTable("offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  terms: jsonb("terms").$type<OfferTerms>().notNull(),
  termsHash: text("terms_hash").notNull(),
  policyVersion: text("policy_version").notNull(),
  snapshotIds: jsonb("snapshot_ids").$type<string[]>().notNull(),
  decision: text("decision").$type<OfferDecision>().notNull(),
  reasonCodes: jsonb("reason_codes").$type<string[]>().notNull(),
  evidenceMode: text("evidence_mode").$type<EvidenceMode>().notNull(),
  state: text("state")
    .$type<"offered" | "accepted" | "expired" | "declined">()
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const advances = pgTable(
  "advances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id),
    termsHash: text("terms_hash").notNull(),
    tokenChainId: integer("token_chain_id").notNull(),
    tokenAddress: text("token_address").notNull(),
    tokenDecimals: integer("token_decimals").notNull(),
    treasuryAddress: text("treasury_address").notNull(),
    merchantAddress: text("merchant_address").notNull(),
    principalAmount: bigint("principal_amount", { mode: "bigint" }).notNull(),
    obligationAmount: bigint("obligation_amount", { mode: "bigint" }).notNull(),
    collectionRateBps: integer("collection_rate_bps").notNull(),
    periodCeilingAmount: bigint("period_ceiling_amount", {
      mode: "bigint",
    }).notNull(),
    periodSeconds: integer("period_seconds").notNull(),
    state: text("state").$type<AdvanceState>().notNull(),
    fundingIntentId: uuid("funding_intent_id"),
    confirmedOutstandingAmount: bigint("confirmed_outstanding_amount", {
      mode: "bigint",
    }).notNull(),
    periodAnchor: timestamp("period_anchor", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One OPEN advance per merchant (open = funding_pending/active/paused).
    // This is the database half of the one-open-advance invariant.
    uniqueIndex("advances_one_open_per_merchant")
      .on(t.merchantId)
      .where(sql`state in ('funding_pending', 'active', 'paused')`),
  ],
);

export const authorizations = pgTable("authorizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id),
  advanceId: uuid("advance_id").references(() => advances.id),
  chainId: integer("chain_id").notNull(),
  tokenAddress: text("token_address").notNull(),
  keyAddress: text("key_address").notNull(),
  keyPublicKey: text("key_public_key"),
  scopes: jsonb("scopes").$type<AccessKeyScope[]>().notNull(),
  periodSeconds: integer("period_seconds"),
  periodCeilingAmount: bigint("period_ceiling_amount", { mode: "bigint" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  state: text("state").$type<AuthorizationState>().notNull(),
  authorizationTxHash: text("authorization_tx_hash"),
  revokedTxHash: text("revoked_tx_hash"),
  witness: text("witness"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  revokedConfirmedAt: timestamp("revoked_confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const receiptEvents = pgTable(
  "receipt_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    blockHash: text("block_hash").notNull(),
    blockTimestamp: timestamp("block_timestamp", {
      withTimezone: true,
    }).notNull(),
    sender: text("sender").notNull(),
    recipient: text("recipient").notNull(),
    tokenAddress: text("token_address").notNull(),
    amountBaseUnits: bigint("amount_base_units", { mode: "bigint" }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Event identity: replaying the same log must be a no-op.
    uniqueIndex("receipt_events_identity").on(t.chainId, t.txHash, t.logIndex),
    index("receipt_events_recipient_window").on(t.recipient, t.blockTimestamp),
  ],
);

export const receiptClassifications = pgTable(
  "receipt_classifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => receiptEvents.id),
    version: integer("version").notNull(),
    eligible: boolean("eligible").notNull(),
    reasonCode: text("reason_code").notNull(),
    provenance: text("provenance").notNull(),
    reviewStatus: text("review_status").notNull(),
    evidenceMode: text("evidence_mode").$type<EvidenceMode>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("receipt_classifications_version").on(t.eventId, t.version),
  ],
);

export const revenueSnapshots = pgTable(
  "revenue_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    includedEvents: jsonb("included_events")
      .$type<EventReference[]>()
      .notNull(),
    excludedEvents: jsonb("excluded_events").$type<ExcludedEvent[]>().notNull(),
    netEligibleAmount: bigint("net_eligible_amount", {
      mode: "bigint",
    }).notNull(),
    completeness: text("completeness")
      .$type<"complete" | "incomplete">()
      .notNull(),
    completenessNotes: text("completeness_notes").notNull(),
    evidenceMode: text("evidence_mode").$type<EvidenceMode>().notNull(),
    classificationVersion: text("classification_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("revenue_snapshots_merchant_window").on(t.merchantId, t.windowStart),
  ],
);

export const collectionBudgets = pgTable("collection_budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  advanceId: uuid("advance_id")
    .notNull()
    .references(() => advances.id),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  eligibleReceiptsAmount: bigint("eligible_receipts_amount", {
    mode: "bigint",
  }).notNull(),
  rateBps: integer("rate_bps").notNull(),
  ceilingAmount: bigint("ceiling_amount", { mode: "bigint" }).notNull(),
  budgetAmount: bigint("budget_amount", { mode: "bigint" }).notNull(),
  remainingAmount: bigint("remaining_amount", { mode: "bigint" }).notNull(),
  snapshotId: uuid("snapshot_id").references(() => revenueSnapshots.id),
  status: text("status").$type<BudgetStatus>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<PaymentIntentKind>().notNull(),
    // Stable business idempotency key: duplicate jobs never double-pay.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    advanceId: uuid("advance_id")
      .notNull()
      .references(() => advances.id),
    budgetId: uuid("budget_id").references(() => collectionBudgets.id),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    state: text("state").$type<PaymentIntentState>().notNull(),
    txHash: text("tx_hash"),
    nonceKey: text("nonce_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("payment_intents_advance").on(t.advanceId, t.state)],
);

export const paymentAttempts = pgTable("payment_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id")
    .notNull()
    .references(() => paymentIntents.id),
  txHash: text("tx_hash"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  outcome: jsonb("outcome").$type<PaymentOutcome>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const collectionReservations = pgTable("collection_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  advanceId: uuid("advance_id")
    .notNull()
    .references(() => advances.id),
  budgetId: uuid("budget_id").references(() => collectionBudgets.id),
  intentId: uuid("intent_id")
    .notNull()
    .references(() => paymentIntents.id),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  status: text("status").$type<ReservationStatus>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    advanceId: uuid("advance_id")
      .notNull()
      .references(() => advances.id),
    kind: text("kind").$type<LedgerEntryKind>().notNull(),
    // Signed base units: disbursement positive, repayment negative, adjustments either.
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    intentId: uuid("intent_id").references(() => paymentIntents.id),
    txHash: text("tx_hash"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One ledger effect per chain transaction: reconciled-once repayment.
    uniqueIndex("ledger_entries_tx_once")
      .on(t.advanceId, t.kind, t.txHash)
      .where(sql`tx_hash is not null`),
  ],
);

export const ingestionCursors = pgTable(
  "ingestion_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: text("token_address").notNull(),
    nextBlockNumber: bigint("next_block_number", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ingestion_cursors_chain_token").on(t.chainId, t.tokenAddress),
  ],
);

export const authChallenges = pgTable("auth_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantWalletAddress: text("merchant_wallet_address").notNull(),
  nonce: text("nonce").notNull().unique(),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});
