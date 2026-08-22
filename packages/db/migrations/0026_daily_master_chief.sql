CREATE TABLE "context_source_cache" (
	"source_id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"mtime_ms" double precision NOT NULL,
	"size" integer NOT NULL,
	"content" text NOT NULL,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL
);
