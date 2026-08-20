CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"attempt_number" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"max_steps" integer NOT NULL,
	"steps_used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_runs_status_check" CHECK (status IN ('INITIALIZED', 'PLANNING', 'EXECUTING', 'TOOL_CALLING', 'OBSERVING', 'FINALIZING', 'COMPLETED', 'FAILED', 'CANCELLED', 'ERROR'))
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"file_path" text NOT NULL,
	"current_change_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_status_check" CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'MERGED'))
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"change_id" text NOT NULL,
	"risk_score" real NOT NULL,
	"impact_score" real NOT NULL,
	"novelty_score" real NOT NULL,
	"complexity_score" real NOT NULL,
	"confidence_score" real NOT NULL,
	"combined_priority" real NOT NULL,
	"label" text NOT NULL,
	"factors_unavailable" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_label_check" CHECK (label IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);
--> statement-breakpoint
CREATE TABLE "changes" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"agent_run_id" text NOT NULL,
	"change_type" text NOT NULL,
	"status" text NOT NULL,
	"content_hash" text NOT NULL,
	"diff_summary" text NOT NULL,
	"commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changes_change_type_check" CHECK (change_type IN ('CREATED', 'MODIFIED', 'DELETED', 'RENAMED')),
	CONSTRAINT "changes_status_check" CHECK (status IN ('PENDING', 'VERIFIED', 'REVIEWED', 'ROLLED_BACK'))
);
--> statement-breakpoint
CREATE TABLE "contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"sources" jsonb NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"rank_method" text NOT NULL,
	"summary" text,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"change_id" text NOT NULL,
	"assessment_id" text NOT NULL,
	"decision" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_decision_check" CHECK (decision IN ('APPROVED', 'REJECTED', 'REQUEST_CHANGES', 'OVERRIDDEN', 'DEFERRED', 'ESCALATED'))
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"repo_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"change_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"content" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"attempt_number" integer DEFAULT 0 NOT NULL,
	"assigned_agent" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "tasks_state_check" CHECK (state IN ('PENDING', 'QUEUED', 'EXECUTING', 'VERIFYING', 'AWAITING_REVIEW', 'APPROVED', 'REJECTED', 'REWORK', 'COMPLETED', 'FAILED', 'AWAITING_HUMAN_INTERVENTION', 'CANCELLED', 'RETRYING'))
);
--> statement-breakpoint
CREATE TABLE "verification_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"change_id" text NOT NULL,
	"requested_checks" jsonb NOT NULL,
	"timeout_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_results" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"status" text NOT NULL,
	"check_results" jsonb NOT NULL,
	"execution_env" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_results_status_check" CHECK (status IN ('RUNNING', 'PASSED', 'FAILED', 'ERROR', 'TIMEOUT', 'SKIPPED'))
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contexts" ADD CONSTRAINT "contexts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_request_id_verification_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "verification_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_log_correlation_idx" ON "event_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "event_log_type_idx" ON "event_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "event_log_occurred_at_idx" ON "event_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "snapshots_content_hash_idx" ON "snapshots" USING btree ("content_hash");