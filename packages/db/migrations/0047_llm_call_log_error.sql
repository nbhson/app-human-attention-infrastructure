ALTER TABLE "llm_call_log" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "llm_call_log" ADD COLUMN "status" text DEFAULT 'OK' NOT NULL;--> statement-breakpoint
CREATE INDEX "llm_call_log_status_idx" ON "llm_call_log" USING btree ("status");
