CREATE TABLE "attention_thresholds" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"band" text NOT NULL,
	"cutoff" double precision NOT NULL,
	"min_bounds" double precision NOT NULL,
	"max_bounds" double precision NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"supersedes" text,
	CONSTRAINT "attention_thresholds_band_check" CHECK (band IN ('HIGH', 'CRITICAL'))
);
--> statement-breakpoint
ALTER TABLE "review_queue" ADD COLUMN "deferred_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attention_thresholds" ADD CONSTRAINT "attention_thresholds_supersedes_attention_thresholds_id_fk" FOREIGN KEY ("supersedes") REFERENCES "attention_thresholds"("id") ON DELETE no action ON UPDATE no action;