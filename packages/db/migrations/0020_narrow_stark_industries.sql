CREATE TABLE "calibration_weights" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"method" text NOT NULL,
	"weights" jsonb NOT NULL,
	"fit_config" jsonb NOT NULL,
	"log_loss_fitted" double precision NOT NULL,
	"log_loss_placeholder" double precision NOT NULL,
	"ranking_accuracy_fitted" double precision NOT NULL,
	"ranking_accuracy_placeholder" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calibration_weights" ADD CONSTRAINT "calibration_weights_dataset_id_calibration_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "calibration_datasets"("id") ON DELETE no action ON UPDATE no action;