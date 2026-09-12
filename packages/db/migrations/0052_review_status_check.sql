-- Hard-enforce the review pipeline status machine at the storage layer
-- (Fowler, Refactoring Databases): a typo'd review_status fails the INSERT
-- instead of silently branching the UI. Adds the CHECK constraint on
-- existing rows first; any legacy row outside the machine would fail loudly
-- (none are expected — the worker writes only these seven values).
ALTER TABLE "review_reports" DROP CONSTRAINT IF EXISTS "review_reports_review_status_check";--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_status_check" CHECK ("review_status" IN ('pending', 'fetching', 'recalling', 'reviewing', 'storing', 'complete', 'error'));