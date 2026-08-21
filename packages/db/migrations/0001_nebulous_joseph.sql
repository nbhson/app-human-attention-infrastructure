CREATE TABLE "task_state_history" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"triggered_by" text NOT NULL,
	"trigger_event_id" text,
	"rationale" text,
	"attempt_number" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_state_history" ADD CONSTRAINT "task_state_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_state_history_task_idx" ON "task_state_history" USING btree ("task_id");