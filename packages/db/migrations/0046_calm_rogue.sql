ALTER TABLE "review_reports" ADD COLUMN "review_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_reports" ADD COLUMN "batch_progress" jsonb;