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

import type { JudgeRunID, ReviewReportID } from './ids.js';

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
  /** Unique run id — referenced by [`JudgeAgreementRecord`](#JudgeAgreementRecord) rows. */
  readonly id: JudgeRunID;
  /** The report that was judged. */
  readonly reportId: ReviewReportID;
  /** The PR the judged report reviewed (denormalised for traceability). */
  readonly prUrl: string;
  /** The versioned rubric prompt the judge used — scores are uninterpretable without it. */
  readonly promptVersion: string;
  /** The concrete model id that produced the judgment. */
  readonly model: string;
  /** The sampling temperature the run was produced under (day-22 §2.2 provenance). */
  readonly temperature?: number;
  /** SHA-256 of the judged artifact (verdict + summary + findings) — reproducibility. */
  readonly reportHash: string;
  /** The numeric scores. */
  readonly scores: JudgeScores;
  /** The judge's short rationale, verbatim. */
  readonly reasoning: string;
  /** When the run was recorded. */
  readonly createdAt: Date;
}

/**
 * The judge-run audit store (day-21). `record` persists one completed run —
 * including its `reportHash`/`temperature` provenance so any downstream agreement
 * figure can be recomputed from the rows (day-22 §2.2). `@harness/db`'s
 * `DrizzleJudgeRunStore` implements it behind the `judge_runs` table.
 */
export interface JudgeRunStore {
  record(run: JudgeRun): Promise<void>;
}

/**
 * One dimension of inter-judge agreement, computed across N score pairs
 * (day-22 §2.1). Severity and routing drift independently, so each rubric
 * dimension gets its own agreement + κ rather than one collapsed scalar.
 */
export interface AgreementDimension {
  /** Number of score pairs this dimension was aggregated over. */
  readonly n: number;
  /** Mean `|a - b|` across pairs — 0 is perfect agreement. */
  readonly meanAbsDiff: number;
  /** Continuous agreement rate `1 - meanAbsDiff`, in `[0,1]`. */
  readonly agreement: number;
  /** Cohen's κ on the `>= 0.5` flag — agreement above chance. */
  readonly kappa: number;
}

/** Per-dimension inter-judge agreement (day-22 §2.1). */
export interface JudgeAgreement {
  readonly severity: AgreementDimension;
  readonly routing: AgreementDimension;
  readonly evidence: AgreementDimension;
  readonly overall: AgreementDimension;
}

/**
 * One persisted inter-judge agreement computation (day-22 §2.4). Carries the very
 * run ids it was computed from (plus their report hashes) so the number can be
 * recomputed from the audit rows — a screenshot is not an audit.
 */
export interface JudgeAgreementRecord {
  /** The first judge's run ids, `i`-matched to `bRunIds`. */
  readonly aRunIds: readonly JudgeRunID[];
  /** The second judge's run ids, `i`-matched to `aRunIds`. */
  readonly bRunIds: readonly JudgeRunID[];
  /** Canonical report hashes, `i`-matched to the pairs. */
  readonly reportHashes: readonly string[];
  /** The computed per-dimension agreement. */
  readonly agreement: JudgeAgreement;
  /** When the computation was recorded. */
  readonly createdAt: Date;
}

/**
 * The inter-judge agreement store (day-22). Append-only: every call records a new
 * `judge_agreement` row; nothing is updated in place. `@harness/db`'s
 * `DrizzleJudgeAgreementStore` implements it.
 */
export interface JudgeAgreementStore {
  record(agreement: JudgeAgreementRecord): Promise<void>;
}
