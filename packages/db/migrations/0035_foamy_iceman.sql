CREATE TABLE "memory_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"retrieved_count" integer DEFAULT 0 NOT NULL,
	"last_retrieved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"supersedes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_entries_kind_check" CHECK (kind IN ('REVIEW', 'FINDING', 'DECISION', 'PROJECT'))
);
--> statement-breakpoint
CREATE TABLE "memory_entry_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_entry_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_supersedes_memory_entries_id_fk" FOREIGN KEY ("supersedes") REFERENCES "memory_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entry_evidence" ADD CONSTRAINT "memory_entry_evidence_memory_entry_id_memory_entries_id_fk" FOREIGN KEY ("memory_entry_id") REFERENCES "memory_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entry_evidence" ADD CONSTRAINT "memory_entry_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_entries_kind_idx" ON "memory_entries" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "memory_entries_supersedes_idx" ON "memory_entries" USING btree ("supersedes");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entry_evidence_entry_evidence_unique" ON "memory_entry_evidence" USING btree ("memory_entry_id","evidence_id");