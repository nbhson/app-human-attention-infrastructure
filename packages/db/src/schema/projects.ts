import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** A monitored codebase. One row per project (orchestrator spec §2). */
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  repo_path: text('repo_path').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
