/**
 * Weight-fitter tests (day-12 §3.4, §5). Pure — no DB in the compute path.
 *
 * The known-answer cases pin down the fit semantics, not exact coefficients:
 * a perfectly-predictive factor must *dominate* the fitted weight vector, a
 * non-predictive dataset must yield a non-result, and the split must be
 * reproducible from the seed.
 */

import { describe, expect, it } from 'vitest';

import {
  binaryLabel,
  fitWeights,
  normalizeWeights,
  PLACEHOLDER_WEIGHTS,
  stratifiedSplit,
} from '../calibration/weight-fitter.js';
import type { FitConfig, FitSample } from '../calibration/weight-fitter.js';

const CONFIG: FitConfig = {
  seed: 42,
  validationShare: 0.2,
  iterations: 8000,
  learningRate: 0.1,
  regularization: 0.01,
};

function noise(index: number, multiplier: number): number {
  return ((index * multiplier) % 10) / 10;
}

/** `risk` cleanly separates the label; every other feature is irrelevant noise. */
function dominantFactorSamples(count = 200): FitSample[] {
  return Array.from({ length: count }, (_, index) => {
    const risk = index % 2 === 0 ? 0.2 : 0.8; // → label = (risk > 0.5)
    return {
      features: [risk, noise(index, 7), noise(index, 13), noise(index, 17), noise(index, 19)],
      label: risk > 0.5 ? 1 : 0,
    };
  });
}

/** Constant features — no factor carries any signal against the label. */
function nonPredictiveSamples(count = 200): FitSample[] {
  return Array.from({ length: count }, (_, index) => ({
    features: [0.5, 0.5, 0.5, 0.5, 0.5],
    label: (index % 2) as 0 | 1,
  }));
}

describe('binaryLabel', () => {
  it('marks only attention-warranted outcomes as 1', () => {
    expect(binaryLabel('REJECTED')).toBe(1);
    expect(binaryLabel('REWORKED')).toBe(1);
    expect(binaryLabel('DEFECTED_LATER')).toBe(1);
    expect(binaryLabel('APPROVED')).toBe(0);
  });
});

describe('normalizeWeights', () => {
  it('maps coefficients to a convex combination (≥0, sums to 1) even when negative', () => {
    const weights = normalizeWeights([-2, 1, 0, 0.5, -0.5]);
    const sum = weights.risk + weights.impact + weights.novelty + weights.complexity + weights.confidence;
    expect(sum).toBeCloseTo(1, 6);
    for (const value of [weights.risk, weights.impact, weights.novelty, weights.complexity, weights.confidence]) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('preserves coefficient ordering (largest coefficient → largest weight)', () => {
    const weights = normalizeWeights([-2, 3, 0, 0.5, -0.5]);
    expect(weights.impact).toBeGreaterThan(weights.complexity);
    expect(weights.impact).toBeGreaterThan(weights.novelty);
    expect(weights.impact).toBeGreaterThan(weights.confidence);
    expect(weights.impact).toBeGreaterThan(weights.risk);
  });
});

describe('stratifiedSplit', () => {
  it('is reproducible for the same seed', () => {
    const samples = dominantFactorSamples();
    const first = stratifiedSplit(samples, CONFIG);
    const second = stratifiedSplit(samples, CONFIG);
    expect(first.trainIndices).toEqual(second.trainIndices);
    expect(first.validationIndices).toEqual(second.validationIndices);
  });

  it('changes membership when the seed changes', () => {
    const samples = dominantFactorSamples();
    const first = stratifiedSplit(samples, { ...CONFIG, seed: 42 });
    const second = stratifiedSplit(samples, { ...CONFIG, seed: 43 });
    const sort = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);
    expect(sort(first.validationIndices)).not.toEqual(sort(second.validationIndices));
  });

  it('holds out a balanced validation set (both labels present when possible)', () => {
    const samples = dominantFactorSamples(40);
    const split = stratifiedSplit(samples, CONFIG);
    const labels = new Set(split.validation.map((s) => s.label));
    expect(labels.size).toBe(2);
    // Stratification: the two classes are present in the same ratio as training.
    expect(split.validation.some((s) => s.label === 0)).toBe(true);
    expect(split.validation.some((s) => s.label === 1)).toBe(true);
  });
});

describe('fitWeights', () => {
  it('lets a perfectly-predictive factor dominate the fitted weights', () => {
    const result = fitWeights(dominantFactorSamples(), CONFIG);
    const { risk, impact, novelty, complexity, confidence } = result.fittedWeights;
    expect(risk).toBeGreaterThan(impact);
    expect(risk).toBeGreaterThan(novelty);
    expect(risk).toBeGreaterThan(complexity);
    expect(risk).toBeGreaterThan(confidence);
  });

  it('produces fitted weights that sum to 1 (±1e-3) and are non-negative', () => {
    const result = fitWeights(dominantFactorSamples(), CONFIG);
    const w = result.fittedWeights;
    const sum = w.risk + w.impact + w.novelty + w.complexity + w.confidence;
    expect(sum).toBeCloseTo(1, 3);
    for (const value of [w.risk, w.impact, w.novelty, w.complexity, w.confidence]) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports an improvement when the dominant factor predicts, and a better log-loss', () => {
    const result = fitWeights(dominantFactorSamples(), CONFIG);
    expect(result.improvement).toBe(true);
    // The fitted vector concentrates on the predictive factor, so its held-out
    // log-loss is strictly lower than the placeholder's.
    expect(result.fitted.logLoss).toBeLessThan(result.placeholder.logLoss);
  });

  it('is a non-result on a dataset where no factor predicts the label', () => {
    const result = fitWeights(nonPredictiveSamples(), CONFIG);
    expect(result.improvement).toBe(false);
  });
});

describe('PLACEHOLDER_WEIGHTS', () => {
  it('mirrors the Phase-1 constants and sums to 1', () => {
    expect(PLACEHOLDER_WEIGHTS).toEqual({
      risk: 0.35,
      impact: 0.25,
      novelty: 0.15,
      complexity: 0.1,
      confidence: 0.15,
    });
    const sum =
      PLACEHOLDER_WEIGHTS.risk +
      PLACEHOLDER_WEIGHTS.impact +
      PLACEHOLDER_WEIGHTS.novelty +
      PLACEHOLDER_WEIGHTS.complexity +
      PLACEHOLDER_WEIGHTS.confidence;
    expect(sum).toBeCloseTo(1, 6);
  });
});
