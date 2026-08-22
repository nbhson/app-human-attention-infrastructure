import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Calibration fit sets (day-11 §2.3, §3).
 *
 * A `calibration_dataset` is a **frozen, hash-sealed point-in-time snapshot** of
 * the assessment → feedback → outcome join. A fit (Day 12) records the
 * `dataset_id` it consumed, so the exact input is reconstructable and a later
 * "retcon" of history is impossible — the same append-only discipline as
 * `evidence` and `evaluation_reports` (§9 of the architecture spec): a dataset is
 * never UPDATEd or DELETEd, only superseded by a *new* version.
 *
 * `content_hash` covers the ordered row set (`calibration_rows` sorted by
 * `assessment_id`, metadata fields excluded), so two extractions of an unchanged
 * store hash identically while any single tampered row flips the digest.
 */

/** One versioned, immutable dataset of fit-ready calibration rows. */
export const calibrationDatasets = pgTable('calibration_datasets', {
  id: text('id').primaryKey(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Which label the *fit* targets (`feedback` | `outcome`) — the `--label` mode.
  label_source: text('label_source').notNull(),
  row_count: integer('row_count').notNull(),
  // SHA-256 over the ordered, canonicalised row set (see extractor).
  content_hash: text('content_hash').notNull(),
  source_version: text('source_version').notNull(),
  // DEFECTED_LATER lag horizon: "unbounded" means the rework join considers the
  // entire task_state_history (day-11 §6 — a bounded window would leak a late
  // defect as a clean approve inside the dataset).
  defect_lag_horizon: text('defect_lag_horizon').notNull(),
});

/** One row per decided assessment inside a dataset. Append-only: no UPDATE/DELETE. */
export const calibrationRows = pgTable(
  'calibration_rows',
  {
    dataset_id: text('dataset_id')
      .notNull()
      .references(() => calibrationDatasets.id),
    assessment_id: text('assessment_id').notNull(),
    // Provenance (not FK'd — the snapshot must survive source-table changes).
    task_id: text('task_id').notNull(),
    change_id: text('change_id').notNull(),
    run_id: text('run_id').notNull(),
    // Features (what Day 12 fits weights against): the five factor scores.
    factor_scores: jsonb('factor_scores').notNull(),
    combined_priority: real('combined_priority').notNull(),
    // Primary (subjective) label. NULL means "no feedback was given".
    was_useful: boolean('was_useful'),
    // Secondary (objective) label: APPROVED | REJECTED | REWORKED | DEFECTED_LATER.
    outcome: text('outcome').notNull(),
    // Which of the two labels produced this row's label: 'feedback' | 'outcome'.
    label_source: text('label_source').notNull(),
    extracted_at: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.dataset_id, table.assessment_id] })],
);
