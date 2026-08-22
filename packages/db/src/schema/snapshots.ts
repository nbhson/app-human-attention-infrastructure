import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { changes } from './changes.js';

/**
 * Content-addressed full-file snapshots (artifact-tracker spec).
 *
 * `content` holds the bytes inline when `content_backend = 'db'`; for a large
 * object that has been offloaded to the object store (day-21), `content` is
 * `null` and the bytes live under `content_hash` in the object store, to be
 * resolved by the tracker/readers through the `ContentStore` seam.
 */
export const snapshots = pgTable(
  'snapshots',
  {
    id: text('id').primaryKey(),
    change_id: text('change_id')
      .notNull()
      .references(() => changes.id),
    content_hash: text('content_hash').notNull(),
    content: text('content'),
    content_backend: text('content_backend').notNull().default('db'),
    generation: integer('generation').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contentHashIdx: index('snapshots_content_hash_idx').on(table.content_hash),
  }),
);
