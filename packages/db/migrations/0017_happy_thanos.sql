CREATE TABLE "evaluation_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"window_from" timestamp with time zone NOT NULL,
	"window_to" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report" jsonb NOT NULL,
	"source_version" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "evaluation_reports_window_idx" ON "evaluation_reports" USING btree ("window_from","window_to");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_reports_window_source_unique" ON "evaluation_reports" USING btree ("window_from","window_to","source_version");