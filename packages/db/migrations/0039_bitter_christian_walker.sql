CREATE TABLE "review_examples" (
	"id" text PRIMARY KEY NOT NULL,
	"scale_version" text NOT NULL,
	"label_set" text NOT NULL,
	"source" text NOT NULL,
	"pr_diff" text NOT NULL,
	"requirement" text NOT NULL,
	"report" jsonb NOT NULL,
	"gold_severity" double precision NOT NULL,
	"gold_routing" double precision NOT NULL,
	"gold_useful" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "review_examples_scale_version_idx" ON "review_examples" USING btree ("scale_version");