/**
 * Review output value objects (review-reorient Phase 3).
 *
 * The shape the AI reviewer is asked to return — and what the persistence layer
 * consumes. IDs and `createdAt` are deliberately absent: the AI produces raw
 * *findings* and *fix suggestions*; the system assigns identity when it binds
 * them to a {@link ReviewReport}.
 */

import type { FindingKind, ReviewSeverity, ReviewVerdict } from '@harness/domain';

/** One problem the AI found in the PR (unidentified — see module doc). */
export interface ReviewFindingOutput {
  readonly severity: ReviewSeverity;
  /** What to do about it: fix (`correctness`) vs remove/simplify (`cleanup`). */
  readonly kind?: FindingKind;
  readonly file: string;
  readonly line?: number;
  readonly message: string;
  readonly suggestion?: string;
}

/** One actionable fix the AI proposes (unidentified — see module doc). */
export interface FixSuggestionOutput {
  readonly file: string;
  readonly hunk?: string;
  readonly proposed: string;
  readonly rationale: string;
}

/** The full AI review, before identity is assigned. */
export interface ReviewAgentOutput {
  readonly summary: string;
  readonly overallVerdict: ReviewVerdict;
  readonly findings: ReviewFindingOutput[];
  readonly suggestions: FixSuggestionOutput[];
}

/**
 * Phase-4 two-pass: one file's risk assessment from the summary pass.
 * Returned by {@link import('./review-agent.js').ReviewAgent.summarizeFiles}.
 */
export interface FileSummary {
  readonly file: string;
  readonly risk: 'high' | 'medium' | 'low';
  readonly summary: string;
}
