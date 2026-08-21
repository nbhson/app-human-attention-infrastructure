CREATE TABLE "dispatch_log" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_log_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_log" ADD CONSTRAINT "dispatch_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;