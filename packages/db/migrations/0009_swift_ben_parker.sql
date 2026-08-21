CREATE TABLE "verification_test_results" (
	"id" text PRIMARY KEY NOT NULL,
	"check_result_id" text NOT NULL,
	"test_file" text NOT NULL,
	"test_name" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"error" text,
	"was_retried" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_test_results_status_check" CHECK (status IN ('PASSED', 'FAILED', 'SKIPPED'))
);
--> statement-breakpoint
ALTER TABLE "verification_reports" ADD COLUMN "flaky" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_test_results" ADD CONSTRAINT "verification_test_results_check_result_id_verification_check_results_id_fk" FOREIGN KEY ("check_result_id") REFERENCES "verification_check_results"("id") ON DELETE no action ON UPDATE no action;