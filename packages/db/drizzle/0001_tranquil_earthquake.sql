ALTER TABLE "advances" ADD COLUMN "pause_reason_code" text;--> statement-breakpoint
ALTER TABLE "advances" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingestion_cursors" ADD COLUMN "coverage_start_sec" bigint;--> statement-breakpoint
ALTER TABLE "ingestion_cursors" ADD COLUMN "coverage_end_sec" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "advances_offer_once" ON "advances" USING btree ("offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_budgets_advance_period_once" ON "collection_budgets" USING btree ("advance_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_snapshots_merchant_window_once" ON "revenue_snapshots" USING btree ("merchant_id","window_start");