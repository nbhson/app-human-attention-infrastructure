ALTER TABLE "writeback_log" DROP CONSTRAINT "writeback_log_report_id_review_reports_id_fk";--> statement-breakpoint
DROP INDEX "writeback_log_report_id_idx";--> statement-breakpoint
ALTER TABLE "writeback_log" DROP CONSTRAINT "writeback_log_target_check";--> statement-breakpoint
ALTER TABLE "writeback_log" DROP CONSTRAINT "writeback_log_status_check";--> statement-breakpoint
ALTER TABLE "writeback_log" DROP COLUMN "report_id";--> statement-breakpoint
ALTER TABLE "writeback_log" DROP COLUMN "target";--> statement-breakpoint
ALTER TABLE "writeback_log" ADD COLUMN "provider" text NOT NULL;--> statement-breakpoint
ALTER TABLE "writeback_log" ADD COLUMN "external_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "writeback_log" ADD COLUMN "dedup_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "writeback_log" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "writeback_log" ADD CONSTRAINT "writeback_log_status_check" CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'DUPLICATE'));--> statement-breakpoint
CREATE UNIQUE INDEX "writeback_log_dedup_succeeded_uniq" ON "writeback_log" USING btree ("dedup_key") WHERE "writeback_log"."status" = 'SUCCEEDED';--> statement-breakpoint
CREATE INDEX "writeback_log_provider_external_idx" ON "writeback_log" USING btree ("provider","external_id");