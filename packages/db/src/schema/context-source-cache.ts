import { doublePrecision, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Context source cache (day-20 §2.1) — one current entry per collected source.
 *
 * The key is `source_id` (the repo-relative path); the `content_hash` is the
 * *truth* carried in the row (§2.2), while `mtime_ms` + `size` are the stat
 * fast-path that lets the collector serve a hit with zero file reads (§5.1):
 * on every collect the collector `stat`s each file, and a `(mtime, size)` match
 * means the cached content is still current without re-reading. A changed file
 * has a changed `content_hash` — and in practice a changed mtime — so a stale
 * entry is a miss, never a poisoned hit.
 *
 * This is a read-optimization leaf: it caches *source content only*, never a
 * `ContextSnapshot` (§2.3). Entries are upserted by `source_id` (one row per
 * source) and torn down by `invalidate` on artifact change.
 */
export const contextSourceCache = pgTable('context_source_cache', {
  source_id: text('source_id').primaryKey(),
  content_hash: text('content_hash').notNull(),
  /** `stat().mtimeMs` — the zero-read fast-path discriminator. */
  mtime_ms: doublePrecision('mtime_ms').notNull(),
  /** `stat().size` (bytes) — second half of the stat discriminator. */
  size: integer('size').notNull(),
  /** The parsed source content (the collector's only transform is `readFile → text`). */
  content: text('content').notNull(),
  stored_at: timestamp('stored_at', { withTimezone: true }).notNull().defaultNow(),
});
