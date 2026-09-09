ALTER TABLE "review_decisions" ADD COLUMN "dedup_key" text;--> statement-breakpoint
-- Backfill pre-P0 rows: 'legacy:' + PK is guaranteed unique and can never
-- collide with new sha256-hex keys, so the NOT NULL + unique guard below
-- holds on legacy data without needing pgcrypto.
UPDATE "review_decisions" SET "dedup_key" = ('legacy:' || "id") WHERE "dedup_key" IS NULL;--> statement-breakpoint
ALTER TABLE "review_decisions" ALTER COLUMN "dedup_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_decisions_dedup_key_uniq" ON "review_decisions" USING btree ("dedup_key");
