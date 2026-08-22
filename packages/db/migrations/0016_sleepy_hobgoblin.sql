CREATE TABLE "trace_correlation" (
	"trace_id" text NOT NULL,
	"span_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trace_correlation_trace_id_span_id_pk" PRIMARY KEY("trace_id","span_id")
);
--> statement-breakpoint
CREATE INDEX "trace_correlation_correlation_idx" ON "trace_correlation" USING btree ("correlation_id");