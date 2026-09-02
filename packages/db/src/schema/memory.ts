import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { memoryKindCheck, memoryStatusCheck } from './enums.js';
import { evidence } from './evidence.js';

/**
 * Review-memory entries (review-reorient Phase 3, day-16 §2).
 *
 * Past reviews, findings, and decisions distilled into searchable context for the
 * *next* review — never code-generation state. One table with a `kind`
 * discriminator so a relevance query can score across every tier at once.
 * `content` is the curated summary (not raw log); `metadata` holds kind-specific
 * fields; `supersedes` is the self-referential version-chain edge Day 17 fills.
 */
export const memoryEntries = pgTable(
  'memory_entries',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    confidence: integer('confidence').notNull().default(0),
    retrieved_count: integer('retrieved_count').notNull().default(0),
    last_retrieved_at: timestamp('last_retrieved_at', { withTimezone: true }),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    supersedes: text('supersedes').references((): AnyPgColumn => memoryEntries.id),
    status: text('status').notNull().default('ACTIVE'),
    confidence_floor: integer('confidence_floor').notNull().default(10),
    metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    memoryKindCheck,
    memoryStatusCheck,
    index('memory_entries_kind_idx').on(table.kind),
    index('memory_entries_supersedes_idx').on(table.supersedes),
  ],
);

/**
 * Many-to-many, append-only binding between a memory entry and the evidence rows
 * that produced it (day-16 §2.3). The compound UNIQUE constraint makes re-linking
 * the same evidence to the same entry idempotent, mirroring `evidence_links`.
 * Together with `MemoryStore`'s ≥1 write-time invariant, this guarantees an entry
 * never exists without provenance.
 */
export const memoryEntryEvidence = pgTable(
  'memory_entry_evidence',
  {
    id: text('id').primaryKey(),
    memory_entry_id: text('memory_entry_id')
      .notNull()
      .references(() => memoryEntries.id),
    evidence_id: text('evidence_id')
      .notNull()
      .references(() => evidence.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('memory_entry_evidence_entry_evidence_unique').on(table.memory_entry_id, table.evidence_id)],
);
