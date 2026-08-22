DROP INDEX "context_source_embeddings_source_idx";--> statement-breakpoint
ALTER TABLE "context_source_embeddings" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "context_source_embeddings" ALTER COLUMN "dimensions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "context_source_embeddings" ADD COLUMN "truncated_chars" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "context_source_embeddings" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "context_source_embeddings_source_idx" ON "context_source_embeddings" USING btree ("source_id");