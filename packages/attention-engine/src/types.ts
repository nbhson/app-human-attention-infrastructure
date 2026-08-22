/**
 * Attention Engine score types (day-18 §2.1).
 *
 * The corrected scoring formula lives here: the `confidence` factor enters the
 * combined priority as `w_confidence · (1 − confidence_score)`. *Low* agent
 * confidence therefore *raises* priority — the exact inverse of the v0.1 spec
 * bug (day-18 §1). The weights are declared placeholders; Phase 2 calibration
 * (day-19 feedback + Phase 2 fit) is the only thing allowed to change them.
 */

import type { ArtifactID, AssessmentID, ChangeID, TaskID } from '@harness/domain';

/** Placeholder factor weights — must sum to 1.0 (day-18 §5). */
export const PRIORITY_WEIGHTS = {
  risk: 0.35,
  impact: 0.25,
  novelty: 0.15,
  complexity: 0.1,
  // Note the key is `confidence`; the *value* field on FactorScores is
  // `confidenceScore` (named distinctly so the inversion is hard to miss).
  confidence: 0.15,
} as const;

/**
 * A complete five-factor weight vector — a convex combination (non-negative,
 * sums to 1.0) over the `FACTOR_KEYS`. {@link PRIORITY_WEIGHTS} is the Phase-1
 * placeholder; Day 12 fits a data-derived vector that a {@link AttentionWeights
 * WeightsProvider} can return in its place.
 */
export interface AttentionWeights {
  readonly risk: number;
  readonly impact: number;
  readonly novelty: number;
  readonly complexity: number;
  readonly confidence: number;
}

/** The canonical factor names, in score-order. */
export const FACTOR_KEYS = ['risk', 'impact', 'novelty', 'complexity', 'confidence'] as const;
/** One factor name. `confidence` maps to {@link FactorScores.confidenceScore}. */
export type FactorKey = (typeof FACTOR_KEYS)[number];

/** Review priority label (attention spec §2.1). */
export type PriorityLabel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** The five component scores, each `[0, 1]`. */
export interface FactorScores {
  readonly risk: number;
  readonly impact: number;
  readonly novelty: number;
  readonly complexity: number;
  /** Agent/verification confidence proxy — LOW confidence ⇒ HIGH priority. */
  readonly confidenceScore: number;
}

/** A persisted attention assessment (engine-local shape, day-18 §2.1). */
export interface AttentionAssessment {
  readonly id: AssessmentID;
  readonly taskId: TaskID;
  readonly changeId: ChangeID;
  /** The artifact the assessed change touches (mirrors `assessments.artifact_id`). */
  readonly artifactId: ArtifactID;
  /** Component scores; unavailable factors hold a neutral `0.5` placeholder. */
  readonly factors: FactorScores;
  /** Factor names that were unavailable and had their weight redistributed. */
  readonly factorsUnavailable: FactorKey[];
  /** Combined priority in `[0, 1]`. */
  readonly combinedPriority: number;
  readonly label: PriorityLabel;
}
