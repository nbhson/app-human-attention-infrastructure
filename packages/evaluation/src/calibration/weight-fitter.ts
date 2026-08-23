/**
 * Weight fitting (day-12 §2.1, §2.2, §3.2).
 *
 * Fits the five Attention weights (`risk`, `impact`, `novelty`, `complexity`,
 * `confidence`) from a frozen calibration dataset, replacing the Phase-1
 * placeholder with a data-derived convex combination. This module is **pure**:
 * every function takes plain samples/config and returns plain values — no
 * `Date.now()`, no `Math.random()`, no I/O — so a fit is reproducible from the
 * same `dataset_id` and stays unit-testable with no DB in the compute path.
 *
 * Design decisions (documented as the v0 simplification, day-12 §2.1/§6):
 *  - The label is the *objective* binary "did this assessment deserve attention?":
 *    `1` for `REJECTED | REWORKED | DEFECTED_LATER`, `0` for `APPROVED`. The
 *    subjective `was_useful` feedback is carried by Day 11 but not the v0 label.
 *  - Features are the five factor scores, with `confidence` entering as the
 *    *deficit* `(1 − confidence)` — the same inversion the engine applies, so a
 *    fitted `confidence` weight is directly consumable by `computePriority`.
 *  - The model is logistic regression; the weight vector is the *softmax* of the
 *    raw feature coefficients (a convex combination: non-negative, sums to 1).
 *    The intercept/bias is reported but excluded from both the weight vector and
 *    the before/after comparison (the engine formula has no bias term).
 *  - `improvement` means the fitted vector **ranks warranted above non-warranted
 *    strictly better** than the placeholder on held-out validation — or, on a
 *    ranking tie, strictly lowers log-loss. Ranking is insensitive to the
 *    variance reduction a trivially-calibrated fit would enjoy, so a fit cannot
 *    "improve" by learning to always predict 0.5.
 */

import type { FactorScores } from './extractor.js';

/** The five fit features, in engine scoring order. */
export const FEATURE_KEYS = ['risk', 'impact', 'novelty', 'complexity', 'confidence'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** A convex-combination weight vector (non-negative, sums to 1.0). */
export interface WeightsVector {
  readonly risk: number;
  readonly impact: number;
  readonly novelty: number;
  readonly complexity: number;
  readonly confidence: number;
}

/** The objective binary label: `1` = attention was warranted. */
export type BinaryLabel = 0 | 1;

/** One fit sample: the five features plus the binary label. */
export interface FitSample {
  /** `[risk, impact, novelty, complexity, 1 − confidence]`. */
  readonly features: readonly number[];
  readonly label: BinaryLabel;
}

/** Solver + split hyperparameters (persisted into `calibration_weights.fit_config`). */
export interface FitConfig {
  readonly seed: number;
  readonly validationShare: number;
  readonly iterations: number;
  readonly learningRate: number;
  readonly regularization: number;
}

/** A deterministic train/validation partition. */
export interface Split {
  readonly train: readonly FitSample[];
  readonly validation: readonly FitSample[];
  readonly trainIndices: readonly number[];
  readonly validationIndices: readonly number[];
}

/** The before/after comparison result. */
export interface FitResult {
  readonly split: Split;
  readonly bias: number;
  readonly coefficients: readonly number[];
  readonly fittedWeights: WeightsVector;
  readonly placeholder: {
    readonly weights: WeightsVector;
    readonly logLoss: number;
    readonly rankingAccuracy: number;
  };
  readonly fitted: {
    readonly logLoss: number;
    readonly rankingAccuracy: number;
  };
  readonly improvement: boolean;
}

/** Mirror of the Phase-1 placeholder (evaluation may not import attention-engine). */
export const PLACEHOLDER_WEIGHTS: WeightsVector = {
  risk: 0.35,
  impact: 0.25,
  novelty: 0.15,
  complexity: 0.1,
  confidence: 0.15,
};

/** Objectives warrant human attention (day-12 §2.1). */
const ATTENTION_WARRANTED: ReadonlySet<string> = new Set([
  'REJECTED',
  'REWORKED',
  'DEFECTED_LATER',
]);

/** Float-noise tolerances for the improvement gate (day-12 §2.4). */
export const RANKING_EPS = 1e-6;
export const LOG_LOSS_EPS = 1e-9;

/** Map an objective outcome to the binary "deserved attention" label. */
export function binaryLabel(outcome: string): BinaryLabel {
  return ATTENTION_WARRANTED.has(outcome) ? 1 : 0;
}

/** The five features from a factor-score record (`confidence` → deficit). */
export function toFeatureVector(scores: FactorScores): number[] {
  return [scores.risk, scores.impact, scores.novelty, scores.complexity, 1 - scores.confidence];
}

/** Deterministic 32-bit PRNG (mulberry32) — reproducible, seeded splits. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless Fisher–Yates shuffle over a copy of `items` with `rng`. */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}

/**
 * Stratified, seeded, reproducible split (day-12 §2.2). Each label class is
 * shuffled with a seed derived from `seed + classOrdinal`, then the first
 * `validationShare` fraction is held out. Held-out size is at least one per
 * class when the class has ≥2 samples, and always leaves ≥1 for training, so a
 * divergence between the two seeds is what changes membership — never the
 * shuffle order of a merged, unstratified pool.
 */
export function stratifiedSplit(samples: readonly FitSample[], config: FitConfig): Split {
  const byClass = new Map<BinaryLabel, number[]>();
  samples.forEach((sample, index) => {
    const list = byClass.get(sample.label) ?? [];
    list.push(index);
    byClass.set(sample.label, list);
  });

  const trainIndices: number[] = [];
  const validationIndices: number[] = [];
  let ordinal = 0;
  for (const indices of byClass.values()) {
    const rng = mulberry32(config.seed + ordinal * 1_000_003);
    ordinal += 1;
    const shuffled = shuffle(indices, rng);
    const length = indices.length;
    const validationCount =
      length >= 2
        ? Math.min(length - 1, Math.max(1, Math.floor(length * config.validationShare)))
        : 0;
    validationIndices.push(...shuffled.slice(0, validationCount));
    trainIndices.push(...shuffled.slice(validationCount));
  }

  return {
    train: trainIndices.map((i) => samples[i]!),
    validation: validationIndices.map((i) => samples[i]!),
    trainIndices,
    validationIndices,
  };
}

/** Numerically-stable logistic sigmoid. */
function sigmoid(z: number): number {
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

/** Logistic `score` (engine formula `dot(weights, features)`, always in [0, 1]). */
export function linearScore(weights: WeightsVector, features: readonly number[]): number {
  return (
    features[0]! * weights.risk +
    features[1]! * weights.impact +
    features[2]! * weights.novelty +
    features[3]! * weights.complexity +
    features[4]! * weights.confidence
  );
}

/** Clamp `p` away from the log-loss poles. */
function clampProbability(p: number): number {
  return Math.min(1 - 1e-9, Math.max(1e-9, p));
}

/** Mean binary cross-entropy of `weights` used as a probability (day-12 §2.1). */
export function logLoss(weights: WeightsVector, samples: readonly FitSample[]): number {
  if (samples.length === 0) {
    return 0;
  }
  let total = 0;
  for (const sample of samples) {
    const p = clampProbability(linearScore(weights, sample.features));
    total += sample.label === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return total / samples.length;
}

/**
 * Pairwise ranking accuracy (≈ AUC): fraction of (warranted, non-warranted) pairs
 * whose scores are correctly ordered, ties counting half. Vacuous (1.0) when a
 * single label class is present — there is no ordering to violate.
 */
export function rankingAccuracy(weights: WeightsVector, samples: readonly FitSample[]): number {
  const positives: readonly FitSample[] = samples.filter((s) => s.label === 1);
  const negatives: readonly FitSample[] = samples.filter((s) => s.label === 0);
  if (positives.length === 0 || negatives.length === 0) {
    return 1;
  }
  const positiveScores = positives.map((s) => linearScore(weights, s.features));
  const negativeScores = negatives.map((s) => linearScore(weights, s.features));
  let correct = 0;
  for (const pos of positiveScores) {
    for (const neg of negativeScores) {
      if (pos > neg) {
        correct += 1;
      } else if (pos === neg) {
        correct += 0.5;
      }
    }
  }
  return correct / (positiveScores.length * negativeScores.length);
}

/** Softmax-normalize raw coefficients into a convex-combination weight vector. */
export function normalizeWeights(coefficients: readonly number[]): WeightsVector {
  const clamped = coefficients.map((c) => Math.min(50, Math.max(-50, c)));
  const max = Math.max(...clamped);
  const exps = clamped.map((c) => Math.exp(c - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return {
    risk: exps[0]! / sum,
    impact: exps[1]! / sum,
    novelty: exps[2]! / sum,
    complexity: exps[3]! / sum,
    confidence: exps[4]! / sum,
  };
}

/** Full-batch logistic regression with L2 regularisation (gradient descent). */
export function fitLogistic(
  train: readonly FitSample[],
  config: FitConfig,
): { bias: number; coefficients: readonly number[] } {
  const dimension = FEATURE_KEYS.length;
  let bias = 0;
  const coefficients = new Array<number>(dimension).fill(0);

  for (let iteration = 0; iteration < config.iterations; iteration++) {
    let gradientBias = 0;
    const gradient = new Array<number>(dimension).fill(0);
    for (const sample of train) {
      let z = bias;
      for (let k = 0; k < dimension; k++) {
        z += coefficients[k]! * sample.features[k]!;
      }
      const error = sigmoid(z) - sample.label;
      gradientBias += error;
      for (let k = 0; k < dimension; k++) {
        gradient[k]! += error * sample.features[k]!;
      }
    }
    bias -= config.learningRate * (gradientBias / train.length);
    for (let k = 0; k < dimension; k++) {
      const regularized = gradient[k]! / train.length + config.regularization * coefficients[k]!;
      coefficients[k]! -= config.learningRate * regularized;
    }
  }

  return { bias, coefficients };
}

/**
 * The whole fit: split → fit → normalize → before/after on the held-out split.
 */
export function fitWeights(samples: readonly FitSample[], config: FitConfig): FitResult {
  const split = stratifiedSplit(samples, config);
  const { bias, coefficients } = fitLogistic(split.train, config);
  const fittedWeights = normalizeWeights(coefficients);

  const placeholder = {
    weights: PLACEHOLDER_WEIGHTS,
    logLoss: logLoss(PLACEHOLDER_WEIGHTS, split.validation),
    rankingAccuracy: rankingAccuracy(PLACEHOLDER_WEIGHTS, split.validation),
  };
  const fitted = {
    logLoss: logLoss(fittedWeights, split.validation),
    rankingAccuracy: rankingAccuracy(fittedWeights, split.validation),
  };

  // Ranking-first (invariant to calibration/variance), log-loss as tie-break.
  const improvement =
    fitted.rankingAccuracy > placeholder.rankingAccuracy + RANKING_EPS ||
    (Math.abs(fitted.rankingAccuracy - placeholder.rankingAccuracy) <= RANKING_EPS &&
      fitted.logLoss < placeholder.logLoss - LOG_LOSS_EPS);

  return { split, bias, coefficients, fittedWeights, placeholder, fitted, improvement };
}

/**
 * One judge-augmented fit sample (day-23 §3.2). Unlike {@link FitSample}, which
 * carries a single feature vector, a judge sample carries **two** — the
 * incumbent's own attention-only features and the judge-augmented features — so
 * the before/after comparison scores each arm in its own feature domain over the
 * *same* held-out rows.
 */
export interface JudgeAugmentedSample {
  /** The incumbent's features: `[risk, impact, novelty, complexity, 1−confidence]`. */
  readonly incumbentFeatures: readonly number[];
  /** The judge-augmented features: `[risk, impact, novelty, complexity, judgeDisagreement]`. */
  readonly judgeFeatures: readonly number[];
  readonly label: BinaryLabel;
}

/** The before/after result of a judge-signal refit (day-23 §3.2, §3.4). */
export interface JudgeFitResult {
  readonly split: Split;
  readonly bias: number;
  /** The five raw feature coefficients over the judge-augmented features. */
  readonly coefficients: readonly number[];
  /** The incumbent (unrefitted) weights, unchanged and passed through. */
  readonly incumbentWeights: WeightsVector;
  /** The refitted candidate weights, judged by the judge signal in the confidence slot. */
  readonly candidateWeights: WeightsVector;
  /** The incumbent scored on its own attention-only features, held-out rows. */
  readonly incumbent: {
    readonly logLoss: number;
    readonly rankingAccuracy: number;
  };
  /** The candidate scored on the judge-augmented features, held-out rows. */
  readonly candidate: {
    readonly logLoss: number;
    readonly rankingAccuracy: number;
  };
  /** Does the candidate rank usefulness strictly better than the incumbent? */
  readonly improvement: boolean;
  /**
   * True iff the judge-disagreement column won the *strictly largest* fitted
   * weight — the overfit alarm (day-23 §2.3/§6) that the monitor flags even when
   * the fit nominally improved.
   */
  readonly judgeSignalDominates: boolean;
}

/** Is `value` the unique maximum of the competitor list (no ties)? */
function isUniqueMaximum(value: number, competitors: readonly number[]): boolean {
  return competitors.every((other) => value > other);
}

/**
 * Refit attention weights with the judge signal as a feature, compared against
 * the incumbent (default {@link PLACEHOLDER_WEIGHTS}) — the day-23 §2.2
 * candidate fit. The split is stratified on the `was_useful` label (same
 * discipline as {@link fitWeights}); the candidate is fitted on the
 * judge-augmented features, while the incumbent is scored on its *own*
 * attention-only features over the same validation indices. Ranking accuracy is
 * the primary objective with log-loss as the tie-break, exactly as in Phase 2.
 *
 * Nothing here touches a live default: the candidate is returned, never applied.
 *
 * @throws if `samples` is empty — a fit over zero reviews is a caller error.
 */
export function fitJudgeWeights(
  samples: readonly JudgeAugmentedSample[],
  config: FitConfig,
  incumbent: WeightsVector = PLACEHOLDER_WEIGHTS,
): JudgeFitResult {
  if (samples.length === 0) {
    throw new Error('fitJudgeWeights requires at least one sample');
  }

  const judgeSamples: FitSample[] = samples.map((sample) => ({
    features: sample.judgeFeatures,
    label: sample.label,
  }));
  const split = stratifiedSplit(judgeSamples, config);
  const { bias, coefficients } = fitLogistic(split.train, config);
  const candidateWeights = normalizeWeights(coefficients);

  // Same held-out rows, scored in the incumbent's own feature domain.
  const incumbentValidation: FitSample[] = split.validationIndices.map((index) => ({
    features: samples[index]!.incumbentFeatures,
    label: samples[index]!.label,
  }));

  const incumbentMetrics = {
    logLoss: logLoss(incumbent, incumbentValidation),
    rankingAccuracy: rankingAccuracy(incumbent, incumbentValidation),
  };
  const candidateMetrics = {
    logLoss: logLoss(candidateWeights, split.validation),
    rankingAccuracy: rankingAccuracy(candidateWeights, split.validation),
  };

  // Ranking-first, log-loss as tie-break (day-12 §2.4).
  const improvement =
    candidateMetrics.rankingAccuracy > incumbentMetrics.rankingAccuracy + RANKING_EPS ||
    (Math.abs(candidateMetrics.rankingAccuracy - incumbentMetrics.rankingAccuracy) <= RANKING_EPS &&
      candidateMetrics.logLoss < incumbentMetrics.logLoss - LOG_LOSS_EPS);

  const judgeSignalDominates = isUniqueMaximum(candidateWeights.confidence, [
    candidateWeights.risk,
    candidateWeights.impact,
    candidateWeights.novelty,
    candidateWeights.complexity,
  ]);

  return {
    split,
    bias,
    coefficients,
    incumbentWeights: incumbent,
    candidateWeights,
    incumbent: incumbentMetrics,
    candidate: candidateMetrics,
    improvement,
    judgeSignalDominates,
  };
}
