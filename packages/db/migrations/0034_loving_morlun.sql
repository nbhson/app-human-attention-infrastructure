CREATE TABLE "code_index_deps" (
	"id" text PRIMARY KEY NOT NULL,
	"from_file" text NOT NULL,
	"to_file" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_index_deps_kind_check" CHECK (kind IN ('static', 'dynamic'))
);
--> statement-breakpoint
CREATE TABLE "code_index_symbols" (
	"id" text PRIMARY KEY NOT NULL,
	"file" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"line" integer NOT NULL,
	"column" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_index_symbols_kind_check" CHECK (kind IN ('definition', 'reference'))
);
--> statement-breakpoint
CREATE INDEX "code_index_deps_from_idx" ON "code_index_deps" USING btree ("from_file");--> statement-breakpoint
CREATE INDEX "code_index_deps_to_idx" ON "code_index_deps" USING btree ("to_file");--> statement-breakpoint
CREATE INDEX "code_index_symbols_file_idx" ON "code_index_symbols" USING btree ("file");