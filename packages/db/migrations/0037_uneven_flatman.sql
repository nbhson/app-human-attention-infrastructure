CREATE TABLE "judge_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"severity_agreement" double precision NOT NULL,
	"routing_agreement" double precision NOT NULL,
	"evidence_sufficiency" double precision NOT NULL,
	"overall" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "judge_runs" ADD CONSTRAINT "judge_runs_report_id_review_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "review_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "judge_runs_report_id_idx" ON "judge_runs" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "judge_runs_created_at_idx" ON "judge_runs" USING btree ("created_at");