CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "context_source_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1536),
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_source_embeddings_source_type_check" CHECK (source_type IN ('FILE', 'SYMBOL', 'GIT_HISTORY', 'DOCUMENTATION', 'ARCHITECTURE', 'TEST', 'DECISION', 'EVIDENCE'))
);
--> statement-breakpoint
CREATE INDEX "context_source_embeddings_embedding_idx" ON "context_source_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "context_source_embeddings_source_idx" ON "context_source_embeddings" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "context_source_embeddings_hash_idx" ON "context_source_embeddings" USING btree ("content_hash");