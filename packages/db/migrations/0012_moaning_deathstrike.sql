ALTER TABLE "review_queue" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "review_queue" ADD COLUMN "claimed_at" timestamp with time zone;