CREATE TABLE "source_usefulness" (
	"id" text PRIMARY KEY NOT NULL,
	"context_id" text NOT NULL,
	"source_id" text NOT NULL,
	"useful" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_usefulness" ADD CONSTRAINT "source_usefulness_context_id_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "contexts"("id") ON DELETE no action ON UPDATE no action;