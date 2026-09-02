/**
 * Persistence for the review-slice triage rules — the thin read/upsert over the
 * single-row `triage_rules` table, mirroring `routes/settings.ts`'s direct
 * Drizzle usage (no DI token: callers already resolve `TOKENS.Db`).
 *
 * The row is idempotent by design: reads fall back to the all-ON defaults when
 * no row exists yet, and writes upsert the `singleton` row so an operator toggle
 * never creates a second row.
 */

import { eq } from 'drizzle-orm';

import { triageRules } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

/** The triage rule toggles, including the new auto-review mode. */
export interface TriageRuleState {
  readonly securityBlock: boolean;
  readonly performanceRegression: boolean;
  readonly schemaIntegrity: boolean;
  /**
   * When true, the review agent returns all findings (including MINOR, NIT, INFO)
   * instead of filtering to only CRITICAL/MAJOR. This enables a full code-review
   * mode that surfaces issues like naming, style, and architecture — not just
   * attention-worthy bugs. Defaults to false (human-review mode).
   */
  readonly autoReviewEnabled: boolean;
}

const SINGLETON_ID = 'singleton';

/** The all-ON defaults (autoReviewEnabled defaults to false = human-review mode). */
const DEFAULT_STATE: TriageRuleState = {
  securityBlock: true,
  performanceRegression: true,
  schemaIntegrity: true,
  autoReviewEnabled: false,
};

function toState(row: {
  security_block: boolean;
  performance_regression: boolean;
  schema_integrity: boolean;
  auto_review_enabled: boolean;
}): TriageRuleState {
  return {
    securityBlock: row.security_block,
    performanceRegression: row.performance_regression,
    schemaIntegrity: row.schema_integrity,
    autoReviewEnabled: row.auto_review_enabled,
  };
}

/** Read the current rule state, defaulting to all-ON before the row is seeded. */
export async function loadTriageRuleState(db: DrizzleDB): Promise<TriageRuleState> {
  const rows = await db.select().from(triageRules).where(eq(triageRules.id, SINGLETON_ID)).limit(1);
  const row = rows[0];
  return row === undefined ? DEFAULT_STATE : toState(row);
}

/** Upsert a partial patch onto the singleton row and return the merged state. */
export async function saveTriageRuleState(db: DrizzleDB, patch: Partial<TriageRuleState>): Promise<TriageRuleState> {
  const current = await loadTriageRuleState(db);
  const next: TriageRuleState = {
    securityBlock: patch.securityBlock ?? current.securityBlock,
    performanceRegression: patch.performanceRegression ?? current.performanceRegression,
    schemaIntegrity: patch.schemaIntegrity ?? current.schemaIntegrity,
    autoReviewEnabled: patch.autoReviewEnabled ?? current.autoReviewEnabled,
  };

  await db
    .insert(triageRules)
    .values({
      id: SINGLETON_ID,
      security_block: next.securityBlock,
      performance_regression: next.performanceRegression,
      schema_integrity: next.schemaIntegrity,
      auto_review_enabled: next.autoReviewEnabled,
    })
    .onConflictDoUpdate({
      target: triageRules.id,
      set: {
        security_block: next.securityBlock,
        performance_regression: next.performanceRegression,
        schema_integrity: next.schemaIntegrity,
        auto_review_enabled: next.autoReviewEnabled,
      },
    });

  return next;
}
