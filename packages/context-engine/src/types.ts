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
 * through the request's tokenizer, never a hardcoded number, so Phase 2 can swap
 * in a real tokenizer without changing callers.
 */
export interface Tokenizer {
  count(text: string): number;
}

/**
 * Phase-1 tokenizer: `chars / 4` (context-engine spec §8). A cheap, deterministic
 * estimate — fine for budgeting, and honest because the snapshot records which
 * tokenizer produced the counts (§6).
 */
export class ApproxTokenizer implements Tokenizer {
  count(text: string): number {
    return Math.ceil(text.length / 4);
  }
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
}
