ALTER TABLE "triage_rules" ADD COLUMN "include_instructions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "triage_rules" ADD COLUMN "instructions_content" text;
