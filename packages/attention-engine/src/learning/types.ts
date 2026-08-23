/**
 * Learning-loop types (day-31 §2.1 — Evaluate → Calibrate → (measured) Deploy).
 *
 * The learning pipeline turns *new* human review signals (a usefulness verdict +
 * an LLM-judge's agreement scores, joined per review) into a **proposed** weight
 * vector — never a silently applied one. These types are the contract the three
 * day-31 modules share: the collector produces {@link ReviewFact}s, the job fits a
 * {@link LearningCandidate} through an injected {@link FitSeam}, and the promotion
 * gate makes an explicit {@link PromotionDecision}.
 *
 * The shapes deliberately mirror `@harness/evaluation`'s fitter (`FitSample`,
 * `JudgeAugmentedSample`, `FitConfig`) *without importing it*: `attention-engine`
 * may not depend on an evaluation package (boundary R4 — engines reach only
 * `domain`/`event-bus`/`db`/`di`), so the boundary crosses at a **structural**
 * seam. The app host — the one layer allowed to import both — adapts evaluation's
 * `fitJudgeWeights` onto {@link FitSeam} (see `apps/api/scripts/demo-learning-loop.ts`).
 */

import type { AttentionWeights } from '../types.js';

/** The two judge dimensions the day-23 signal uses; a subset of `JudgeScores`. */
export interface ReviewJudge {
  readonly severityAgreement: number;
  readonly routingAgreement: number;
}

/** The five factor scores, mirroring the engine's `FactorScores` shape. */
export interface ReviewFactors {
  readonly risk: number;
  readonly impact: number;
  readonly novelty: number;
  readonly complexity: number;
  readonly confidence: number;
}

/**
 * One review's aligned evidence — the atomic unit the collect seam returns. A row
 * lacking any one of factors, a judge score, or a usefulness mark has already been
 * excluded by the seam (a row without all three cannot be fit, day-23 §3.1).
 */
export interface ReviewFact {
  readonly reviewId: string;
  readonly factors: ReviewFactors;
  readonly judge: ReviewJudge;
  /** The human's usefulness verdict — the fit's **label**, never a feature. */
  readonly wasUseful: boolean;
  /** When the review's evidence landed — the window cursor. */
  readonly recordedAt: Date;
}

/**
 * One fit-ready sample. `incumbentFeatures` is the engine's own attention factors
 * (slot 4 = `1 − confidence`); `judgeFeatures` replaces slot 4 with the judge
 * disagreement. `label` is the binary "was this review useful" (`1`/`0`).
 */
export interface LearningSample {
  readonly reviewId: string;
  readonly incumbentFeatures: readonly number[];
  readonly judgeFeatures: readonly number[];
  readonly label: 0 | 1;
}

/** The five solver/split hyperparameters, mirrored from evaluation's `FitConfig`. */
export interface LearningFitConfig {
  readonly seed: number;
  readonly validationShare: number;
  readonly iterations: number;
  readonly learningRate: number;
  readonly regularization: number;
}

/**
 * A fitted candidate — the fit seam's output, adapted from evaluation's
 * `JudgeFitResult`. Carries the before/after held-out numbers so the promotion
 * gate (and anyone months later) can answer "why was this proposed?".
 */
export interface LearningCandidate {
  /** The proposed vector, directly consumable by `computePriority`. */
  readonly candidateWeights: AttentionWeights;
  /** The incumbent the candidate was measured against. */
  readonly incumbentWeights: AttentionWeights;
  /** Did the candidate rank usefulness strictly better than the incumbent? */
  readonly improvement: boolean;
  /** Overfit alarm: the judge column took the strictly largest weight. */
  readonly judgeSignalDominates: boolean;
  readonly candidateRankingAccuracy: number;
  readonly incumbentRankingAccuracy: number;
  readonly candidateLogLoss: number;
  readonly incumbentLogLoss: number;
  /** Number of samples the candidate was fit on (provenance). */
  readonly sampleCount: number;
}

/** The fit seam — the boundary crossing `evaluation`'s `fitJudgeWeights`. */
export interface FitSeam {
  fit(
    samples: readonly LearningSample[],
    config: LearningFitConfig,
    incumbent: AttentionWeights,
  ): LearningCandidate;
}

/** The collect seam — reads new review facts (DB in the app; a fake in tests). */
export interface CollectSeam {
  collect(): Promise<readonly ReviewFact[]>;
}

/** The gate's verdict. PROMOTE ⇒ measured WIN; HOLD ⇒ anything short of that. */
export type PromotionOutcome = 'PROMOTE' | 'HOLD';

/** A promotion decision with its reason trace (never a bare verdict). */
export interface PromotionDecision {
  readonly outcome: PromotionOutcome;
  readonly reasons: readonly string[];
}

/** The full, auditable result of one learning-loop tick. */
export interface LearningRun {
  /** Which review ids fed the fit, and the window they were selected from. */
  readonly window: {
    readonly reviewIds: readonly string[];
    readonly since: Date | null;
    readonly collectedAt: Date;
  };
  readonly fitConfig: LearningFitConfig;
  /** `null` when the window held no samples — an honest no-op, not a crash. */
  readonly candidate: LearningCandidate | null;
  /** `null` when there was no candidate to gate. */
  readonly promotion: PromotionDecision | null;
  /**
   * `true` iff the candidate cleared the gate (PROMOTE). The job **never applies**
   * the vector — applying a promoted candidate is a separate, explicit caller step
   * (day-31 §2.2: automation stops at the measured gate).
   */
  readonly promoted: boolean;
}
