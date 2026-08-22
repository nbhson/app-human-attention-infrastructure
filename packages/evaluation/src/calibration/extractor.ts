/**
 * Calibration extraction (day-11 §2.1, §2.4, §3.2).
 *
 * Turns the append-only store's raw evidence into a fit-ready, immutable row
 * set. This module is **pure**: `buildCalibrationRows` takes already-loaded
 * plain records and returns rows + a content hash, so it is reproducible and
 * unit-testable with no live DB in the compute path. The DB reads live in the
 * CLI (`make-dataset-cli.ts`); the writes live in `writer.ts`.
 *
 * Two labels per row, deliberately kept apart (day-11 §2.1):
 *  - `was_useful` — the reviewer's *subjective* signal (`assessment_feedback`),
 *    NULL when no feedback was given (never imputed, never dropped).
 *  - `outcome` — the *objective* signal derived from the decision + downstream
 *    rework, independent of the Attention Engine's own scoring.
 *
 * Features are the assessment's five factor scores + `combined_priority` —
 * exactly what Day 12 fits weights against. They are frozen at the factor
 * level (never re-derived from raw diffs) so the fitted model matches what
 * production actually runs (day-11 §6).
 */

import { createHash } from 'node:crypto';

import { hasLaterDefect } from '../labels.js';
import { stableStringify } from '../replay/hash.js';
import type { ReworkRow } from '../report.js';

/** Which label the fit targets: subjective feedback or objective outcome. */
export type CalibrationLabelMode = 'feedback' | 'outcome';

/** The five attention-engine factor scores (the fit features). */
export interface FactorScores {
  readonly risk: number;
  readonly impact: number;
  readonly novelty: number;
  readonly complexity: number;
  readonly confidence: number;
}

/** One assessment joined to its provenance (task/change/run). */
export interface AssessmentRecord {
  readonly assessmentId: string;
  readonly taskId: string;
  readonly changeId: string;
  readonly runId: string;
  readonly factors: FactorScores;
  readonly combinedPriority: number;
  readonly createdAt: Date;
}

/** One usefulness-feedback submission (append-only; latest wins). */
export interface FeedbackRecord {
  readonly assessmentId: string;
  readonly wasUseful: boolean;
  readonly createdAt: Date;
}

/** One human review decision (append-only; latest wins). */
export interface DecisionRecord {
  readonly assessmentId: string;
  readonly decision: string;
  readonly createdAt: Date;
}

/** The raw, read-only inputs the extractor reduces. */
export interface CalibrationInput {
  readonly assessments: readonly AssessmentRecord[];
  readonly feedback: readonly FeedbackRecord[];
  readonly decisions: readonly DecisionRecord[];
  readonly rework: readonly ReworkRow[];
}

/** One fit-ready row (before the writer assigns `dataset_id`). */
export interface CalibrationRow {
  readonly assessmentId: string;
  readonly taskId: string;
  readonly changeId: string;
  readonly runId: string;
  readonly factorScores: FactorScores;
  readonly combinedPriority: number;
  readonly wasUseful: boolean | null;
  readonly outcome: 'APPROVED' | 'REJECTED' | 'REWORKED' | 'DEFECTED_LATER';
  readonly labelSource: 'feedback' | 'outcome';
}

const REJECTION_DECISIONS: ReadonlySet<string> = new Set(['REJECTED', 'REQUEST_CHANGES']);

/**
 * Derive the objective `outcome` from a decision and a downstream-defect flag.
 *
 * Precedence matters: a human decision is the most informative signal when it
 * exists, and a rejection *wins* over a later rework (a rejected change going
 * back to `REWORK` is the expected consequence, not a "we missed it" defect).
 * `DEFECTED_LATER` therefore names only the cases where the objective record
 * contradicts a clean pass — an approve-then-defect, or a fly-through that
 * later reworked (the escalation-leak the Day-06 metrics already track).
 */
export function deriveOutcome(
  decision: string | null,
  laterDefect: boolean,
): CalibrationRow['outcome'] {
  if (decision !== null) {
    if (decision === 'APPROVED') {
      return laterDefect ? 'DEFECTED_LATER' : 'APPROVED';
    }
    if (REJECTION_DECISIONS.has(decision)) {
      return 'REJECTED';
    }
    // OVERRIDDEN | DEFERRED | ESCALATED — the human redirected the change.
    return laterDefect ? 'DEFECTED_LATER' : 'REWORKED';
  }
  // No human decision → an auto-approvable fly-through.
  return laterDefect ? 'DEFECTED_LATER' : 'APPROVED';
}

/**
 * Build the fit-ready row set and its content hash. The latest decision and the
 * latest feedback win per assessment; a re-assessment with a newer outcome
 * supersedes the older one (mirrors `MetricsComputer`).
 */
export function buildCalibrationRows(
  input: CalibrationInput,
  mode: CalibrationLabelMode,
): { rows: CalibrationRow[]; contentHash: string } {
  const latestDecision = new Map<string, DecisionRecord>();
  for (const decision of input.decisions) {
    const existing = latestDecision.get(decision.assessmentId);
    if (existing === undefined || decision.createdAt.getTime() >= existing.createdAt.getTime()) {
      latestDecision.set(decision.assessmentId, decision);
    }
  }

  const latestFeedback = new Map<string, FeedbackRecord>();
  for (const feedback of input.feedback) {
    const existing = latestFeedback.get(feedback.assessmentId);
    if (existing === undefined || feedback.createdAt.getTime() >= existing.createdAt.getTime()) {
      latestFeedback.set(feedback.assessmentId, feedback);
    }
  }

  const rows: CalibrationRow[] = input.assessments.map((assessment) => {
    const decision = latestDecision.get(assessment.assessmentId) ?? null;
    const feedback = latestFeedback.get(assessment.assessmentId);
    const wasUseful = feedback?.wasUseful ?? null;
    const laterDefect = hasLaterDefect(assessment.taskId, assessment.createdAt, input.rework);
    const outcome = deriveOutcome(decision?.decision ?? null, laterDefect);
    const labelSource: CalibrationRow['labelSource'] =
      mode === 'feedback' ? (wasUseful !== null ? 'feedback' : 'outcome') : 'outcome';

    return {
      assessmentId: assessment.assessmentId,
      taskId: assessment.taskId,
      changeId: assessment.changeId,
      runId: assessment.runId,
      factorScores: assessment.factors,
      combinedPriority: assessment.combinedPriority,
      wasUseful,
      outcome,
      labelSource,
    };
  });

  return { rows, contentHash: hashRows(rows) };
}

/** Canonical form of a row for hashing — metadata (`dataset_id`, `extracted_at`) excluded. */
function canonicalRow(row: CalibrationRow): unknown {
  return {
    assessmentId: row.assessmentId,
    taskId: row.taskId,
    changeId: row.changeId,
    runId: row.runId,
    factorScores: row.factorScores,
    combinedPriority: row.combinedPriority,
    wasUseful: row.wasUseful,
    outcome: row.outcome,
    labelSource: row.labelSource,
  };
}

/** SHA-256 over the ordered (assessment-id-sorted) row set. */
export function hashRows(rows: readonly CalibrationRow[]): string {
  const ordered = [...rows].sort((a, b) => a.assessmentId.localeCompare(b.assessmentId));
  return createHash('sha256')
    .update(stableStringify(ordered.map(canonicalRow)))
    .digest('hex');
}
