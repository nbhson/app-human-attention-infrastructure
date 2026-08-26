CREATE TABLE "review_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"head_sha" text,
	"content_hash" text,
	"overall" text,
	"duration_ms" integer,
	"flag" jsonb,
	"rendered" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_verifications_status_check" CHECK (status IN ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED', 'ERROR'))
);
--> statement-breakpoint
ALTER TABLE "review_verifications" ADD CONSTRAINT "review_verifications_report_id_review_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."review_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_verifications_report_id_unique" ON "review_verifications" USING btree ("report_id");