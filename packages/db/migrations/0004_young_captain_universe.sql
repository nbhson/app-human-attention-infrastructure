CREATE TABLE "retry_log" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"step_index" integer NOT NULL,
	"attempt_number" integer NOT NULL,
	"failure_class" text NOT NULL,
	"error_message" text NOT NULL,
	"delay_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retry_log" ADD CONSTRAINT "retry_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;