/**
 * Corpus loader (day-24 §3.2) — reads gold-labelled review examples out of the
 * `review_examples` table, filtered by `scale_version`, into typed
 * {@link ReviewExample}s.
 *
 * The per-row mapping and the version filter are pure and unit-tested without a
 * DB; only `loadReviewExamples` reaches the store (`@harness/db`), and it does so
 * read-only via `@harness/db`'s `ReadonlyDb` — the benchmark never mutates the
 * corpus.
 */

import { eq } from 'drizzle-orm';
import { reviewExamples } from '@harness/db';
import type { ReadonlyDb } from '@harness/db';

import type { JudgedArtifact, ReviewExample, ReviewExampleRow } from './review-example.js';
import { toReviewExample } from './review-example.js';

/** Map a Drizzle `review_examples` row into the normalized {@link ReviewExampleRow}. */
function normalizeRow(row: typeof reviewExamples.$inferSelect): ReviewExampleRow {
  return {
    id: row.id,
    scaleVersion: row.scale_version,
    labelSet: row.label_set,
    source: row.source,
    prDiff: row.pr_diff,
    requirement: row.requirement,
    report: row.report as JudgedArtifact,
    goldSeverity: row.gold_severity,
    goldRouting: row.gold_routing,
    goldUseful: row.gold_useful,
    createdAt: row.created_at,
  };
}

/**
 * Load the corpus, optionally filtered to a single `scaleVersion`. Returns typed
 * examples in insertion order (no re-ordering — the corpus is append-only and the
 * caller applies any deterministic ordering it needs).
 */
export async function loadReviewExamples(db: ReadonlyDb, scaleVersion?: string): Promise<ReviewExample[]> {
  const rows =
    scaleVersion !== undefined
      ? await db.select().from(reviewExamples).where(eq(reviewExamples.scale_version, scaleVersion))
      : await db.select().from(reviewExamples);
  return rows.map((row) => toReviewExample(normalizeRow(row)));
}
