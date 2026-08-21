import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { evidenceKindCheck, evidenceSubjectKindCheck } from './enums.js';

/**
 * Immutable, content-hashed evidence records (day-17 §2.1).
 *
 * Every *claim* in the trust pipeline (a check result, an agent assertion) links
 * back to the *proof* that supports it — the untruncated check output, the test
 * results, a snapshot. `body` is always full content; the inline `output` column
 * on `verification_check_results` stays capped at 64 KB while this table holds
 * the whole thing. Like `snapshots`, evidence is append-only: never deleted.
 */
export const evidence = pgTable(
  'evidence',
  {
    id: text('id').primaryKey(),
    content_hash: text('content_hash').notNull(),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [evidenceKindCheck, index('evidence_content_hash_idx').on(table.content_hash)],
);

/**
 * Many-to-many, append-only binding between an evidence record and the subject(s)
 * it proves (a check result, an artifact, a report, an agent run). The compound
 * UNIQUE constraint makes re-linking the same evidence to the same subject
 * idempotent (day-17 §6).
 */
export const evidenceLinks = pgTable(
  'evidence_links',
  {
    id: text('id').primaryKey(),
    evidence_id: text('evidence_id')
      .notNull()
      .references(() => evidence.id),
    subject_kind: text('subject_kind').notNull(),
    subject_id: text('subject_id').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    evidenceSubjectKindCheck,
    uniqueIndex('evidence_links_evidence_subject_unique').on(
      table.evidence_id,
      table.subject_kind,
      table.subject_id,
    ),
  ],
);
