CREATE TABLE "auto_approve_kill_switch" (
	"id" text PRIMARY KEY NOT NULL,
	"auto_approve_enabled" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"killed_at" timestamp with time zone,
	"killed_by" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_decision_check";--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "sample" boolean;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "dataset_id" text;--> statement-breakpoint
ALTER TABLE "review_queue" ADD COLUMN "sampled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_approve_kill_switch" ADD CONSTRAINT "auto_approve_kill_switch_killed_by_users_id_fk" FOREIGN KEY ("killed_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decision_check" CHECK (decision IN ('APPROVED', 'REJECTED', 'REQUEST_CHANGES', 'OVERRIDDEN', 'DEFERRED', 'ESCALATED', 'AUTO_APPROVED'));--> statement-breakpoint
INSERT INTO "auto_approve_kill_switch" ("id", "auto_approve_enabled", "enabled") VALUES ('singleton', false, true);