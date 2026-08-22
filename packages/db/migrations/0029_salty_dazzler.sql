CREATE TABLE "code_mode_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"workspace_content_hash" text NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_mode_sessions" ADD CONSTRAINT "code_mode_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;