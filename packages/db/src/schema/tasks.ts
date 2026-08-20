import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { taskStateCheck } from './enums.js';
import { projects } from './projects.js';

/**
 * The canonical task record + state machine (orchestrator spec §3). `state` is
 * the authoritative Task status; the CHECK below mirrors the full union.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id),
    title: text('title').notNull(),
    description: text('description'),
    state: text('state').notNull().default('PENDING'),
    attempt_number: integer('attempt_number').notNull().default(0),
    assigned_agent: text('assigned_agent'),
    // `task_id + attempt_number` — idempotency guard against double dispatch.
    idempotency_key: text('idempotency_key').notNull().unique(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [taskStateCheck],
);
