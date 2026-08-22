import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { assessments } from './assessments.js';
import { reviewQueueStatusCheck, routingActionCheck } from './enums.js';
import { tasks } from './tasks.js';

/**
 * A single routing decision (attention spec §4).
 *
 * Every `attention.assessment_created` that survives policy lands here as an
 * append-only, explainable row: it records which `policy_version` and `rule_id`
 * produced the `action`, so an audit can answer *why* an item was routed the way
 * it was — even after the policy changes. `position` orders the queue FIFO
 * within this Phase-1 build (priority ordering lives in the Day-22 read query).
 *
 * `AUTO_APPROVABLE` rows enter the queue flagged, **not** auto-approved — Phase 1
 * has no auto-approve transition; the flag exists so a future phase can flip it
 * without a schema change.
 */
export const reviewQueue = pgTable(
  'review_queue',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id),
    assessment_id: text('assessment_id')
      .notNull()
      .references(() => assessments.id),
    action: text('action').notNull(),
    policy_version: integer('policy_version').notNull(),
    rule_id: text('rule_id').notNull(),
    position: integer('position').notNull(),
    status: text('status').notNull().default('QUEUED'),
    // Claim bookkeeping (day-22 §2.2): the reviewer who claimed and when. Both
    // null until a human claims the item; `claim` sets them in a guarded UPDATE.
    claimed_by: text('claimed_by'),
    claimed_at: timestamp('claimed_at', { withTimezone: true }),
    // Day-13 budget deferral: set to the next UTC day boundary when a MEDIUM/LOW
    // item is gated by the daily review budget. NULL means "not deferred" — the
    // row is actionable now. A deferred row is still QUEUED, never DROPPED.
    deferred_until: timestamp('deferred_until', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [routingActionCheck, reviewQueueStatusCheck],
);
