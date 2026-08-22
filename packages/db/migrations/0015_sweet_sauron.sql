ALTER TABLE "decisions" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "actor_email" text;--> statement-breakpoint
ALTER TABLE "event_log" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;