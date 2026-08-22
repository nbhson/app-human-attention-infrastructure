/**
 * Pure combined-priority scoring (day-18 §2.3).
 *
 * The corrected formula:
 *
 *   combined_priority =
 *       ( w_risk·risk
 *       + w_impact·impact
 *       + w_novelty·novelty
 *       + w_complexity·complexity
 *       + w_confidence·(1 − confidence_score) )
 *     / Σ(weights of available factors)
 *
 * Two things are deliberate here:
 *
 *  1. The `confidence` term is `(1 − confidence_score)` — the v0.1 spec had it
 *     inverted, so confident-but-not-trusted runs scored *lower* when they
 *     should score *higher*. A shakier run (low confidence) now raises priority.
 *  2. An unavailable factor does **not** contribute a neutral `0.5`; its weight
 *     is simply dropped from numerator and denominator, redistributing it
 *     proportionally across the remaining factors (day-18 §2.3 "0.5 not used").
 */

import { FACTOR_KEYS, PRIORITY_WEIGHTS } from './types.js';
import type { AttentionWeights, FactorKey, FactorScores, PriorityLabel } from './types.js';

/** Read the numeric score for each factor (`confidence` reads `confidenceScore`). */
const SCORE: Readonly<Record<FactorKey, (f: FactorScores) => number>> = {
  risk: (f) => f.risk,
  impact: (f) => f.impact,
  novelty: (f) => f.novelty,
  complexity: (f) => f.complexity,
  confidence: (f) => f.confidenceScore,
};

/**
 * Combine {@link FactorScores} into a `[0, 1]` priority, redistributing the
 * weight of every factor named in `unavailable`.
 *
 * `weights` defaults to {@link PRIORITY_WEIGHTS} so existing callers are
 * unchanged; the Day-12 `WeightsProvider` seam (see
 * {@link import('./weights/weights-provider.js')}) threads a fitted vector
 * through this parameter instead of replacing the constant.
 *
 * Returns `null` when **every** factor is unavailable (division by zero) — the
 * caller must refuse to score and default the label to `HIGH` (fail toward
 * human attention, never away).
 */
export function computePriority(
  f: FactorScores,
  unavailable: readonly FactorKey[],
  weights: AttentionWeights = PRIORITY_WEIGHTS,
): number | null {
  let weightTotal = 0;
  let raw = 0;

  for (const key of FACTOR_KEYS) {
    if (unavailable.includes(key)) {
      continue;
    }
    const weight = weights[key];
    const value = SCORE[key](f);
    weightTotal += weight;
    // The single asymmetry in the formula: confidence is inverted.
    raw += key === 'confidence' ? weight * (1 - value) : weight * value;
  }

  if (weightTotal === 0) {
    return null;
  }
  return raw / weightTotal;
}

/** Map a combined priority to its label (exact boundaries, day-18 §2.3/§5). */
export function labelFor(priority: number): PriorityLabel {
  if (priority >= 0.8) return 'CRITICAL';
  if (priority >= 0.6) return 'HIGH';
  if (priority >= 0.3) return 'MEDIUM';
  return 'LOW';
}

/** Sum of {@link PRIORITY_WEIGHTS} — must equal 1.0 (static assertion, day-18 §5). */
export function weightSum(): number {
  return FACTOR_KEYS.reduce((sum, key) => sum + PRIORITY_WEIGHTS[key], 0);
}
