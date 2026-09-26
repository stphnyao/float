CREATE TABLE "advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"terms_hash" text NOT NULL,
	"token_chain_id" integer NOT NULL,
	"token_address" text NOT NULL,
	"token_decimals" integer NOT NULL,
	"treasury_address" text NOT NULL,
	"merchant_address" text NOT NULL,
	"principal_amount" bigint NOT NULL,
	"obligation_amount" bigint NOT NULL,
	"collection_rate_bps" integer NOT NULL,
	"period_ceiling_amount" bigint NOT NULL,
	"period_seconds" integer NOT NULL,
	"state" text NOT NULL,
	"funding_intent_id" uuid,
	"confirmed_outstanding_amount" bigint NOT NULL,
	"period_anchor" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_wallet_address" text NOT NULL,
	"nonce" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "auth_challenges_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"advance_id" uuid,
	"chain_id" integer NOT NULL,
	"token_address" text NOT NULL,
	"key_address" text NOT NULL,
	"key_public_key" text,
	"scopes" jsonb NOT NULL,
	"period_seconds" integer,
	"period_ceiling_amount" bigint,
	"expires_at" timestamp with time zone,
	"state" text NOT NULL,
	"authorization_tx_hash" text,
	"revoked_tx_hash" text,
	"witness" text,
	"confirmed_at" timestamp with time zone,
	"revoked_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advance_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"eligible_receipts_amount" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"ceiling_amount" bigint NOT NULL,
	"budget_amount" bigint NOT NULL,
	"remaining_amount" bigint NOT NULL,
	"snapshot_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advance_id" uuid NOT NULL,
	"budget_id" uuid,
	"intent_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" text NOT NULL,
	"next_block_number" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advance_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"intent_id" uuid,
	"tx_hash" text,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"terms" jsonb NOT NULL,
	"terms_hash" text NOT NULL,
	"policy_version" text NOT NULL,
	"snapshot_ids" jsonb NOT NULL,
	"decision" text NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"evidence_mode" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"tx_hash" text,
	"submitted_at" timestamp with time zone,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"advance_id" uuid NOT NULL,
	"budget_id" uuid,
	"amount" bigint NOT NULL,
	"state" text NOT NULL,
	"tx_hash" text,
	"nonce_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "receipt_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"eligible" boolean NOT NULL,
	"reason_code" text NOT NULL,
	"provenance" text NOT NULL,
	"review_status" text NOT NULL,
	"evidence_mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"sender" text NOT NULL,
	"recipient" text NOT NULL,
	"token_address" text NOT NULL,
	"amount_base_units" bigint NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"included_events" jsonb NOT NULL,
	"excluded_events" jsonb NOT NULL,
	"net_eligible_amount" bigint NOT NULL,
	"completeness" text NOT NULL,
	"completeness_notes" text NOT NULL,
	"evidence_mode" text NOT NULL,
	"classification_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_advance_id_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_budgets" ADD CONSTRAINT "collection_budgets_advance_id_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_budgets" ADD CONSTRAINT "collection_budgets_snapshot_id_revenue_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."revenue_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reservations" ADD CONSTRAINT "collection_reservations_advance_id_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reservations" ADD CONSTRAINT "collection_reservations_budget_id_collection_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."collection_budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reservations" ADD CONSTRAINT "collection_reservations_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_advance_id_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_advance_id_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_budget_id_collection_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."collection_budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_classifications" ADD CONSTRAINT "receipt_classifications_event_id_receipt_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."receipt_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_snapshots" ADD CONSTRAINT "revenue_snapshots_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advances_one_open_per_merchant" ON "advances" USING btree ("merchant_id") WHERE state in ('funding_pending', 'active', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_cursors_chain_token" ON "ingestion_cursors" USING btree ("chain_id","token_address");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_tx_once" ON "ledger_entries" USING btree ("advance_id","kind","tx_hash") WHERE tx_hash is not null;--> statement-breakpoint
CREATE INDEX "payment_intents_advance" ON "payment_intents" USING btree ("advance_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_classifications_version" ON "receipt_classifications" USING btree ("event_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_events_identity" ON "receipt_events" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "receipt_events_recipient_window" ON "receipt_events" USING btree ("recipient","block_timestamp");--> statement-breakpoint
CREATE INDEX "revenue_snapshots_merchant_window" ON "revenue_snapshots" USING btree ("merchant_id","window_start");