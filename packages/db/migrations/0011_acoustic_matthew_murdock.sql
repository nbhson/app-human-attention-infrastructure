CREATE TABLE "assessment_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"assessment_id" text NOT NULL,
	"was_useful" boolean NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"assessment_id" text NOT NULL,
	"action" text NOT NULL,
	"policy_version" integer NOT NULL,
	"rule_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_queue_action_check" CHECK (action IN ('REVIEW_REQUIRED', 'REVIEW_RECOMMENDED', 'AUTO_APPROVABLE', 'ESCALATE')),
	CONSTRAINT "review_queue_status_check" CHECK (status IN ('QUEUED', 'CLAIMED', 'DECIDED', 'DROPPED'))
);
--> statement-breakpoint
ALTER TABLE "assessment_feedback" ADD CONSTRAINT "assessment_feedback_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE no action ON UPDATE no action;