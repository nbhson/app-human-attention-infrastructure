-- Review completion time: wall-clock instant the pipeline reached a terminal
-- stage (`complete` / `error`). Nullable: rows still in flight stay NULL; legacy
-- rows completed before this migration keep NULL (UI falls back to "unknown").
ALTER TABLE "review_reports" ADD COLUMN "completed_at" timestamp with time zone;
