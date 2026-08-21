CREATE TABLE "verification_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"change_id" text NOT NULL,
	"task_id" text NOT NULL,
	"overall" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_reports_overall_check" CHECK (overall IN ('PASSED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "verification_check_results" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"check_kind" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"output" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_check_results_status_check" CHECK (status IN ('PASSED', 'FAILED', 'FLAKY', 'TIMED_OUT', 'SKIPPED'))
);
--> statement-breakpoint
ALTER TABLE "verification_reports" ADD CONSTRAINT "verification_reports_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_reports" ADD CONSTRAINT "verification_reports_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_check_results" ADD CONSTRAINT "verification_check_results_report_id_verification_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "verification_reports"("id") ON DELETE no action ON UPDATE no action;