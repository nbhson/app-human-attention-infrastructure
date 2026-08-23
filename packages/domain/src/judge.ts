/**
 * The review-quality judge port (review-reorient Phase 3 day-21).
 *
 * The judge scores a *review report* against a rubric — never the PR's code —
 * and records the run so the score is auditable, not trusted unlogged. These
 * types live here (in `@harness/domain`, the shared contract) rather than in
 * `@harness/judge` or `@harness/db` because the two are boundary-forbidden from
 * importing each other: `@harness/judge` produces the scores and consumes the
 * store, and `@harness/db` implements the store — and both import the contract
 * from the middle. The exact same seam-placement as {@link WritebackLogStore}.
 */

import type { ReviewReportID } from './ids.js';

/**
 * Numeric rubric scores, each in `[0,1]`. Prose-only "this is a good review"
 * can't feed agreement stats (day-22) or weight fitting (day-23), so the rubric
 * lands on numbers.
 */
export interface JudgeScores {
  /** Did the report rate each finding's severity correctly? */
  severityAgreement: number;
  /** Did the report route the PR to the right human attention? */
  routingAgreement: number;
  /** Is every claim evidence-backed (message + suggestion/file/line)? */
  evidenceSufficiency: number;
  /** The weighted rubric total. */
  overall: number;
}

/** One audited judge run — the proof a score was produced, by which prompt/model. */
export interface JudgeRun {
  /** The report that was judged. */
  readonly reportId: ReviewReportID;
  /** The PR the judged report reviewed (denormalised for traceability). */
  readonly prUrl: string;
  /** The versioned rubric prompt the judge used — scores are uninterpretable without it. */
  readonly promptVersion: string;
  /** The concrete model id that produced the judgment. */
  readonly model: string;
  /** The numeric scores. */
  readonly scores: JudgeScores;
  /** The judge's short rationale, verbatim. */
  readonly reasoning: string;
  /** When the run was recorded. */
  readonly createdAt: Date;
}

/**
 * The judge-run audit store (day-21). `record` persists one completed run;
 * `@harness/db`'s `DrizzleJudgeRunStore` implements it behind the `judge_runs`
 * table. Shadow-only today — nothing reads the scores yet (day-22 wires the
 * consumer).
 */
export interface JudgeRunStore {
  record(run: JudgeRun): Promise<void>;
}
