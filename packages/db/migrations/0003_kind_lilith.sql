CREATE TABLE "task_step_log" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_ver" integer NOT NULL,
	"step_index" integer NOT NULL,
	"step_kind" text NOT NULL,
	"status" text NOT NULL,
	"output" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "task_step_log" ADD CONSTRAINT "task_step_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;