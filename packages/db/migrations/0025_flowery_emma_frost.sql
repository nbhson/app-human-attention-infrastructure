CREATE TABLE "shadow_rank_comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"context_id" text NOT NULL,
	"keyword_order" jsonb NOT NULL,
	"semantic_order" jsonb NOT NULL,
	"rank_correlation" numeric,
	"top_k" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
