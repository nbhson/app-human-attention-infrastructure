/**
 * Context Engine core types (day-20 §2.1).
 *
 * The engine reuses the domain's rich {@link @harness/domain!ContextSource} and
 * {@link @harness/domain!ContextSnapshot} as its *output* shapes (persisted into
 * the `contexts` table), but defines a minimal {@link ContextRequest} as its
 * *input* — the scan only needs a local task description + target files, not the
 * domain's `projectId`/`repository` provenance fields.
 */

import type { ContextPolicy, TaskID } from '@harness/domain';

/**
 * Token counting seam (context-engine spec §8). Budgets are always interpreted
 * through the request's tokenizer, never a hardcoded number. Day 19 fills this
 * with the exact `TiktokenTokenizer`; the `name` is stamped on the snapshot so
 * the provenance records which counter produced the counts (§6).
 */
export interface Tokenizer {
  /** Token count of `text` in the encoding's own unit. */
  count(text: string): number;
  /**
   * Truncate `text` to at most `maxTokens` tokens by encode → slice → decode.
   * Returns a valid prefix (never splits a surrogate pair); the full text when
   * it already fits; the empty string for a non-positive budget.
   */
  truncate(text: string, maxTokens: number): string;
  /** Stable provenance label, e.g. `tiktoken:cl100k_base`. */
  readonly name: string;
}

/** The engine's minimal context-resolution request (day-20 §2.1). */
export interface ContextRequest {
  readonly taskId: TaskID;
  /** Task description used for keyword ranking. */
  readonly taskDescription: string;
  /** Developer requirements (also tokenized into ranking keywords). */
  readonly requirements: string;
  /** Files explicitly named in the task — never trimmed from the snapshot. */
  readonly targetFiles: readonly string[];
  /** Token budget for the snapshot (interpreted via the request's tokenizer). */
  readonly maxTokens: number;
  /** Optional policy override. */
  readonly policy?: ContextPolicy;
  /**
   * Per-request opt-in for the semantic shadow (day-18 §3.3). Default OFF: when
   * absent, {@link ContextEngine.resolveWithShadow} serves keyword-only and makes
   * zero embedding calls (the default-off test asserts exactly that).
   */
  readonly semanticShadowEnabled?: boolean;
}
