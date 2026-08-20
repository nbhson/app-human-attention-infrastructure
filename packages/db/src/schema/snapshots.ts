import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { changes } from './changes.js';

/** Content-addressed full-file snapshots (artifact-tracker spec). */
export const snapshots = pgTable(
  'snapshots',
  {
    id: text('id').primaryKey(),
    change_id: text('change_id')
      .notNull()
      .references(() => changes.id),
    content_hash: text('content_hash').notNull(),
    content: text('content').notNull(),
    generation: integer('generation').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contentHashIdx: index('snapshots_content_hash_idx').on(table.content_hash),
  }),
);
