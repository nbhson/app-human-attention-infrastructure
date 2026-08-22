CREATE TABLE "calibration_datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label_source" text NOT NULL,
	"row_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"source_version" text NOT NULL,
	"defect_lag_horizon" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_rows" (
	"dataset_id" text NOT NULL,
	"assessment_id" text NOT NULL,
	"task_id" text NOT NULL,
	"change_id" text NOT NULL,
	"run_id" text NOT NULL,
	"factor_scores" jsonb NOT NULL,
	"combined_priority" real NOT NULL,
	"was_useful" boolean,
	"outcome" text NOT NULL,
	"label_source" text NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calibration_rows_dataset_id_assessment_id_pk" PRIMARY KEY("dataset_id","assessment_id")
);
--> statement-breakpoint
ALTER TABLE "calibration_rows" ADD CONSTRAINT "calibration_rows_dataset_id_calibration_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "calibration_datasets"("id") ON DELETE no action ON UPDATE no action;