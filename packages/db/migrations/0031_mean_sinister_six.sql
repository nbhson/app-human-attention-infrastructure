CREATE TABLE "review_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"severity" text NOT NULL,
	"file" text NOT NULL,
	"line" integer,
	"message" text NOT NULL,
	"suggestion" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_findings_severity_check" CHECK (severity IN ('CRITICAL', 'MAJOR', 'MINOR', 'NIT', 'INFO'))
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text,
	"correlation_id" text,
	"pr_url" text NOT NULL,
	"pr_number" integer NOT NULL,
	"repo" text NOT NULL,
	"pr_title" text NOT NULL,
	"ai_provider" text NOT NULL,
	"model" text NOT NULL,
	"summary" text NOT NULL,
	"overall_verdict" text NOT NULL,
	"pr_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_reports_ai_provider_check" CHECK (ai_provider IN ('openai', 'anthropic', 'gemini', 'opencode', 'custom')),
	CONSTRAINT "review_reports_overall_verdict_check" CHECK (overall_verdict IN ('APPROVE', 'REQUEST_CHANGES', 'COMMENT'))
);
--> statement-breakpoint
CREATE TABLE "fix_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"file" text NOT NULL,
	"hunk" text,
	"proposed" text NOT NULL,
	"rationale" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider_type" text NOT NULL,
	"base_url" text,
	"model" text,
	"token_redacted" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_configs_kind_check" CHECK (kind IN ('git', 'ticket', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "writeback_log" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"target" text NOT NULL,
	"action" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writeback_log_target_check" CHECK (target IN ('pr', 'ticket')),
	CONSTRAINT "writeback_log_action_check" CHECK (action IN ('comment', 'status', 'label', 'transition')),
	CONSTRAINT "writeback_log_status_check" CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_report_id_review_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "review_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_suggestions" ADD CONSTRAINT "fix_suggestions_report_id_review_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "review_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writeback_log" ADD CONSTRAINT "writeback_log_report_id_review_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "review_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_findings_report_id_idx" ON "review_findings" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "review_reports_pr_url_idx" ON "review_reports" USING btree ("pr_url");--> statement-breakpoint
CREATE INDEX "review_reports_task_id_idx" ON "review_reports" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "fix_suggestions_report_id_idx" ON "fix_suggestions" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "writeback_log_report_id_idx" ON "writeback_log" USING btree ("report_id");