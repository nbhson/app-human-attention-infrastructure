ALTER TABLE "agent_runs" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "llm_call_log" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "verification_reports" ADD COLUMN "correlation_id" text;