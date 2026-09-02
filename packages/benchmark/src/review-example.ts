/**
 * Review-quality benchmark corpus value types (day-24 §2.1).
 *
 * The corpus is **review examples, not coding tasks**. Each example is the raw
 * material a reviewer sees — a redacted PR diff and a requirement — plus the AI's
 * review report (as a judged artifact) and the human's **gold** labels. Gold
 * labels are human-derived, never judge output: a corpus of the judge's own
 * scores would teach nothing (day-24 §6).
 *
 * The gold label scale is a plain `[0,1]` agreement, matching the judge's own
 * `JudgeScores` contract, so no scale conversion sits between the judge and the
 * benchmark. Changing the rubric scale bumps {@link SCALE_VERSION} and retags
 * labels rather than mutating them in place.
 */

import type { ReviewSeverity, ReviewVerdict } from '@harness/domain';

/** The rubric scale version the corpus's gold labels are valid under. */
export const SCALE_VERSION = 'v1';

/** The human label taxonomy carried by this corpus. */
export const LABEL_SET = 'severity-routing-useful';

/** One finding in a stored, judged artifact (the report's content, redacted). */
export interface ArtifactFinding {
  readonly severity: ReviewSeverity;
  readonly file: string;
  readonly line?: number;
  readonly message: string;
  readonly suggestion?: string;
}

/**
 * The judged artifact: what the rubric grades — the recommended verdict, the
 * summary, and the findings. This is the storage shape of `review_examples.report`
 * (jsonb), independent of a live {@link import('@harness/domain').ReviewReport}'s
 * provenance (id/model/timestamps), which the benchmark reconstructs at run time.
 */
export interface JudgedArtifact {
  readonly verdict: ReviewVerdict;
  readonly summary: string;
  readonly findings: readonly ArtifactFinding[];
}

/** Human gold labels for one review example (day-24 §2.1). */
export interface GoldLabel {
  /** Human rating of severity attribution correctness, in `[0,1]`. */
  readonly severity: number;
  /** Human rating of routing correctness, in `[0,1]`. */
  readonly routing: number;
  /** Did the human find the review useful? */
  readonly useful: boolean;
}

/** A versioned gold-labeled review example — one row of the corpus. */
export interface ReviewExample {
  readonly id: string;
  readonly scaleVersion: string;
  readonly labelSet: string;
  readonly source: string;
  readonly prDiff: string;
  readonly requirement: string;
  readonly report: JudgedArtifact;
  readonly gold: GoldLabel;
  readonly createdAt: Date;
}

/**
 * The plain, snake_case-normalized row shape the corpus loader maps from
 * `review_examples`. Separated from {@link ReviewExample} so the pure mapping +
 * filtering stay testable without a Drizzle row type.
 */
export interface ReviewExampleRow {
  readonly id: string;
  readonly scaleVersion: string;
  readonly labelSet: string;
  readonly source: string;
  readonly prDiff: string;
  readonly requirement: string;
  readonly report: JudgedArtifact;
  readonly goldSeverity: number;
  readonly goldRouting: number;
  readonly goldUseful: boolean;
  readonly createdAt: Date;
}

/** Map a normalized raw row into its typed {@link ReviewExample} (gold bundled). */
export function toReviewExample(row: ReviewExampleRow): ReviewExample {
  return {
    id: row.id,
    scaleVersion: row.scaleVersion,
    labelSet: row.labelSet,
    source: row.source,
    prDiff: row.prDiff,
    requirement: row.requirement,
    report: row.report,
    gold: {
      severity: row.goldSeverity,
      routing: row.goldRouting,
      useful: row.goldUseful,
    },
    createdAt: row.createdAt,
  };
}

/** Keep only the examples whose gold labels are valid under `scaleVersion`. */
export function filterByScaleVersion(examples: readonly ReviewExample[], scaleVersion: string): ReviewExample[] {
  return examples.filter((example) => example.scaleVersion === scaleVersion);
}
