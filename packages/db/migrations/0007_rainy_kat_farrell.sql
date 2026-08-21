CREATE TABLE "trajectory_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"thought" text,
	"tool_name" text,
	"tool_input" jsonb,
	"observation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trajectory_steps" ADD CONSTRAINT "trajectory_steps_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE no action ON UPDATE no action;