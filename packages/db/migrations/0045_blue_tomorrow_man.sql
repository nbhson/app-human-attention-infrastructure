CREATE TABLE "triage_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"security_block" boolean DEFAULT true NOT NULL,
	"performance_regression" boolean DEFAULT true NOT NULL,
	"schema_integrity" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Seed the singleton row so the rules are live (all three ON) from a fresh DB.
INSERT INTO "triage_rules" ("id", "security_block", "performance_regression", "schema_integrity")
VALUES ('singleton', true, true, true);
