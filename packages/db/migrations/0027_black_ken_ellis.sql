ALTER TABLE "snapshots" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "content_backend" text DEFAULT 'db' NOT NULL;