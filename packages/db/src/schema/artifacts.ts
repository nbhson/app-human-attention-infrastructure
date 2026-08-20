import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { artifactStatusCheck } from './enums.js';
import { projects } from './projects.js';

/**
 * Current-version pointer for each tracked file. Content lives in `snapshots`
 * (content-addressed); `current_change_id` points at the latest change without
 * a foreign key (it forms a cycle with `changes.artifact_id`).
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id),
    file_path: text('file_path').notNull(),
    current_change_id: text('current_change_id'),
    status: text('status').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [artifactStatusCheck],
);
