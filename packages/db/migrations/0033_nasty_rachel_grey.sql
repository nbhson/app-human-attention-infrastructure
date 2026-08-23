CREATE TABLE "review_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"decision" text NOT NULL,
	"rationale" text,
	"writeback_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_decisions_decision_check" CHECK (decision IN ('APPROVE', 'REQUEST_CHANGES', 'REJECT'))
);
--> statement-breakpoint
ALTER TABLE "writeback_log" ADD COLUMN "decision_id" text;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_report_id_review_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "review_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_decisions_report_id_idx" ON "review_decisions" USING btree ("report_id");--> statement-breakpoint
ALTER TABLE "writeback_log" ADD CONSTRAINT "writeback_log_decision_id_review_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "review_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "writeback_log_decision_id_idx" ON "writeback_log" USING btree ("decision_id");