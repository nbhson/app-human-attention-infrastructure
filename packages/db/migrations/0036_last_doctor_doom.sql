ALTER TABLE "memory_entries" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD COLUMN "confidence_floor" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_status_check" CHECK (status IN ('ACTIVE', 'ARCHIVED'));