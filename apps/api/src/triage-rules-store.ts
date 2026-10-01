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
  /**
   * When true, the uploaded {@link instructionsContent} (the "text.md" skills /
   * instructions file) is injected into the review prompt alongside the PR diff
   * and Jira requirement — the PR + Jira + text.md + AI flow. When false
   * (default), the flow stays PR + Jira + AI. Mutually meaningful only when
   * instructions are uploaded.
   */
  readonly includeInstructions: boolean;
  /** The uploaded instructions / skill text (markdown) sent to the AI. */
  readonly instructionsContent: string;
  /**
   * Thinking/reasoning budget for reasoning-capable models, forwarded to every
   * review + triage-summary LLM call as `reasoningEffort`.
   *
   * - `'default'` — send nothing (model default; pre-setting behaviour).
   * - `'low'` — cap the trace (`reasoning_effort: "low"`).
   * - `'off'` — ask for no thinking at all (`reasoning_effort: "none"`).
   *
   * Best-effort: some model/server pairs ignore the field on the
   * OpenAI-compatible endpoint. Defaults to `'default'`.
   */
  readonly reasoningEffort: 'default' | 'low' | 'off';
}

/** Valid `reasoningEffort` values (anything else falls back to `'default'`). */
function normalizeReasoningEffort(raw: unknown): 'default' | 'low' | 'off' {
  return raw === 'low' || raw === 'off' ? raw : 'default';
}

const SINGLETON_ID = 'singleton';

/** The all-ON defaults (autoReviewEnabled defaults to false = human-review mode). */
const DEFAULT_STATE: TriageRuleState = {
  securityBlock: true,
  performanceRegression: true,
  schemaIntegrity: true,
  autoReviewEnabled: false,
  includeInstructions: false,
  instructionsContent: '',
  reasoningEffort: 'default',
};

function toState(row: {
  security_block: boolean;
  performance_regression: boolean;
  schema_integrity: boolean;
  auto_review_enabled: boolean;
  include_instructions: boolean;
  instructions_content: string | null;
  reasoning_effort?: string | null;
}): TriageRuleState {
  return {
    securityBlock: row.security_block,
    performanceRegression: row.performance_regression,
    schemaIntegrity: row.schema_integrity,
    autoReviewEnabled: row.auto_review_enabled,
    includeInstructions: row.include_instructions,
    instructionsContent: row.instructions_content ?? '',
    // `reasoning_effort` is absent on rows read through a select that predates
    // the 0056 migration — fall back to the model default then, not to an
    // arbitrary cap.
    reasoningEffort: normalizeReasoningEffort(row.reasoning_effort ?? null),
  };
}

/** Read the current rule state, defaulting to all-ON before the row is seeded. */
export async function loadTriageRuleState(db: DrizzleDB): Promise<TriageRuleState> {
  const rows = await db.select().from(triageRules).where(eq(triageRules.id, SINGLETON_ID)).limit(1);
  const row = rows[0];
  return row === undefined ? DEFAULT_STATE : toState(row);
}

/**
 * Upsert a partial patch onto the singleton row and return the merged state.
 *
 * `instructionsContent` may be explicitly set to `''` to clear the uploaded
 * skills file; `undefined` leaves it unchanged.
 */
export async function saveTriageRuleState(db: DrizzleDB, patch: Partial<TriageRuleState>): Promise<TriageRuleState> {
  const current = await loadTriageRuleState(db);
  const next: TriageRuleState = {
    securityBlock: patch.securityBlock ?? current.securityBlock,
    performanceRegression: patch.performanceRegression ?? current.performanceRegression,
    schemaIntegrity: patch.schemaIntegrity ?? current.schemaIntegrity,
    autoReviewEnabled: patch.autoReviewEnabled ?? current.autoReviewEnabled,
    includeInstructions: patch.includeInstructions ?? current.includeInstructions,
    instructionsContent: patch.instructionsContent ?? current.instructionsContent,
    reasoningEffort: patch.reasoningEffort ?? current.reasoningEffort,
  };

  await db
    .insert(triageRules)
    .values({
      id: SINGLETON_ID,
      security_block: next.securityBlock,
      performance_regression: next.performanceRegression,
      schema_integrity: next.schemaIntegrity,
      auto_review_enabled: next.autoReviewEnabled,
      include_instructions: next.includeInstructions,
      instructions_content: next.instructionsContent,
      // NULL = model default, so a legacy row and an explicit 'default' read
      // identically through `normalizeReasoningEffort`.
      reasoning_effort: next.reasoningEffort === 'default' ? null : next.reasoningEffort,
    })
    .onConflictDoUpdate({
      target: triageRules.id,
      set: {
        security_block: next.securityBlock,
        performance_regression: next.performanceRegression,
        schema_integrity: next.schemaIntegrity,
        auto_review_enabled: next.autoReviewEnabled,
        include_instructions: next.includeInstructions,
        instructions_content: next.instructionsContent,
        reasoning_effort: next.reasoningEffort === 'default' ? null : next.reasoningEffort,
      },
    });

  return next;
}
