ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_status_check";--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "current_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "escalation_reason" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_check" CHECK (status IN ('INITIALIZED', 'PLANNING', 'EXECUTING', 'TOOL_CALLING', 'OBSERVING', 'FINALIZING', 'COMPLETED', 'FAILED', 'ESCALATED', 'CANCELLED', 'ERROR'));