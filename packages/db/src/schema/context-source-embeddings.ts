import { index, integer, pgTable, text, timestamp, vector } from 'drizzle-orm/pg-core';

import { contextSourceTypeCheck } from './enums.js';

/**
 * Per-source semantic embeddings (day-16 §2.1, Phase-2 "widening, not changing").
 *
 * Spec 4 §5.1 calls for embedding a context *source* (not a raw artifact blob)
 * so one physical index serves both semantic retrieval (Day 18) and the A/B
 * shadow metrics. Phase 1 persisted sources as `contexts.sources` jsonb — there
 * is no `context_sources` shard table — so this is the standalone, append-only
 * side table the semantic index lives on. It does **not** touch the live
 * `contexts` / keyword-ranker path: the shadow-then-default guarantee (§2.3) is
 * that nothing on the default `rank_method` path reads or writes this table.
 *
 * A row is one embedding of one (source, content version) pair. `embedding` is
 * NULL until Day 17's population job fills it; the HNSW index skips NULLs. The
 * `dimensions` column records what the issuing adapter produced — never trust
 * the hand-typed `1536` here — so mixed-dimension drift (day-16 §6) is
 * detectable by inspection rather than surfacing as a `vector_cosine_ops` error.
 */
export const contextSourceEmbeddings = pgTable(
  'context_source_embeddings',
  {
    id: text('id').primaryKey(),
    source_id: text('source_id').notNull(),
    source_type: text('source_type').notNull(),
    content_hash: text('content_hash').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    model: text('model').notNull(),
    dimensions: integer('dimensions').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    contextSourceTypeCheck,
    index('context_source_embeddings_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    index('context_source_embeddings_source_idx').on(table.source_id),
    index('context_source_embeddings_hash_idx').on(table.content_hash),
  ],
);
