CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_kind_check" CHECK (kind IN ('CHECK_OUTPUT', 'TEST_RESULTS', 'SNAPSHOT', 'LLM_TRANSCRIPT', 'DIFF', 'HUMAN_NOTE'))
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"id" text PRIMARY KEY NOT NULL,
	"evidence_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_links_subject_kind_check" CHECK (subject_kind IN ('check_result', 'artifact', 'report', 'agent_run'))
);
--> statement-breakpoint
ALTER TABLE "verification_check_results" ADD COLUMN "evidence_id" text;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_content_hash_idx" ON "evidence" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_links_evidence_subject_unique" ON "evidence_links" USING btree ("evidence_id","subject_kind","subject_id");--> statement-breakpoint
ALTER TABLE "verification_check_results" ADD CONSTRAINT "verification_check_results_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE no action ON UPDATE no action;