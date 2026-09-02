import { index, integer, pgTable, text, timestamp, uniqueIndex, vector } from 'drizzle-orm/pg-core';

import { contextSourceTypeCheck } from './enums.js';

/**
 * Per-source semantic embeddings (day-16 §2.1, Phase-2 "widening, not changing").
 *
 * Spec 4 §5.1 calls for embedding a context *source* (not a raw artifact blob)
 * so one physical index serves both semantic retrieval (Day 18) and the A/B
 * shadow metrics. Phase 1 persisted sources as `contexts.sources` jsonb — there
 * is no `context_sources` shard table — so this is the standalone side table the
 * semantic index lives on. It does **not** touch the live `contexts` /
 * keyword-ranker path: the shadow-then-default guarantee (§2.3) is that nothing
 * on the default `rank_method` path reads or writes this table.
 *
 * One row stores the *single current* embedding of one source. A source is keyed
 * by `source_id` (unique); `content_hash` records which content version the
 * stored vector was computed FROM. Day 17's population job fills `embedding`
 * (and `model`/`dimensions`/`embedded_at`) — the three stay NULL while a row is
 * *pending* (seeded but not yet embedded), which is what makes the backfill
 * resumable across a crash. Freshness at read time (day-17 §2.4) is the join
 * `content_hash === <current content hash>`; a changed artifact leaves its row
 * stale until the re-embed listener re-computes it.
 */
export const contextSourceEmbeddings = pgTable(
  'context_source_embeddings',
  {
    id: text('id').primaryKey(),
    source_id: text('source_id').notNull(),
    source_type: text('source_type').notNull(),
    /** SHA-256 of the content this vector was embedded *from* (day-17 §2.4). */
    content_hash: text('content_hash').notNull(),
    /** The unit vector. NULL while pending (day-17 §2.2). */
    embedding: vector('embedding', { dimensions: 1536 }),
    /** Provider/model name; NULL while pending, else the adapter's `model`. */
    model: text('model'),
    /** Vector width produced by the adapter; NULL while pending. */
    dimensions: integer('dimensions'),
    /** Chars truncated before embedding (day-17 §6); 0 means nothing was cut. */
    truncated_chars: integer('truncated_chars').notNull().default(0),
    /** When `embedding` was (last) written; NULL while pending. */
    embedded_at: timestamp('embedded_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    contextSourceTypeCheck,
    index('context_source_embeddings_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    uniqueIndex('context_source_embeddings_source_idx').on(table.source_id),
    index('context_source_embeddings_hash_idx').on(table.content_hash),
  ],
);
