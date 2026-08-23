CREATE TABLE "judge_agreements" (
	"id" text PRIMARY KEY NOT NULL,
	"run_a_ids" text[] NOT NULL,
	"run_b_ids" text[] NOT NULL,
	"report_hashes" text[] NOT NULL,
	"n" integer NOT NULL,
	"severity_agreement" double precision NOT NULL,
	"severity_kappa" double precision NOT NULL,
	"routing_agreement" double precision NOT NULL,
	"routing_kappa" double precision NOT NULL,
	"evidence_agreement" double precision NOT NULL,
	"evidence_kappa" double precision NOT NULL,
	"overall_agreement" double precision NOT NULL,
	"overall_kappa" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "judge_runs" ADD COLUMN "temperature" double precision;--> statement-breakpoint
ALTER TABLE "judge_runs" ADD COLUMN "report_hash" text NOT NULL;--> statement-breakpoint
CREATE INDEX "judge_agreements_created_at_idx" ON "judge_agreements" USING btree ("created_at");