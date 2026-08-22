CREATE TABLE "ab_experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_a" jsonb NOT NULL,
	"variant_b" jsonb NOT NULL,
	"metric" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ab_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"metric_value" double precision NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ab_runs" ADD CONSTRAINT "ab_runs_experiment_id_ab_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "ab_experiments"("id") ON DELETE no action ON UPDATE no action;