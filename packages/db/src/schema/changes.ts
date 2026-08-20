import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { agentRuns } from './agent-runs.js';
import { artifacts } from './artifacts.js';
import { changeStatusCheck, fileChangeTypeCheck } from './enums.js';

/** Immutable record of every AI-produced change (artifact-tracker spec). */
export const changes = pgTable(
  'changes',
  {
    id: text('id').primaryKey(),
    artifact_id: text('artifact_id')
      .notNull()
      .references(() => artifacts.id),
    agent_run_id: text('agent_run_id')
      .notNull()
      .references(() => agentRuns.id),
    change_type: text('change_type').notNull(),
    status: text('status').notNull(),
    content_hash: text('content_hash').notNull(),
    diff_summary: text('diff_summary').notNull(),
    // Set after merge; null for pre-commit changes in Phase 1.
    commit_sha: text('commit_sha'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [fileChangeTypeCheck, changeStatusCheck],
);
