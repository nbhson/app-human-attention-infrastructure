/**
 * `WeightsProvider` seam tests (day-12 §3.5 acceptance).
 *
 * Asserts two things that keep today's "fit but don't flip" discipline honest:
 * the static adapter returns the Phase-1 placeholder exactly, and threading a
 * *different* vector through `computePriority` actually changes the result (so
 * the seam is live, not decorative).
 */

import { describe, expect, it } from 'vitest';

import { computePriority } from '../scoring.js';
import { PRIORITY_WEIGHTS } from '../types.js';
import type { AttentionWeights, FactorScores } from '../types.js';
import { StaticWeightsAdapter } from '../weights/weights-provider.js';

describe('StaticWeightsAdapter', () => {
  it('returns the Phase-1 placeholder weights by default (no live flip)', async () => {
    const provider = new StaticWeightsAdapter();
    const weights = await provider.getActiveWeights();
    expect(weights).toEqual(PRIORITY_WEIGHTS);
  });

  it('defaults to a convex combination (sums to 1.0, all non-negative)', async () => {
    const weights = await new StaticWeightsAdapter().getActiveWeights();
    const keys = ['risk', 'impact', 'novelty', 'complexity', 'confidence'] as const;
    const sum = keys.reduce((acc, key) => acc + weights[key], 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const key of keys) {
      expect(weights[key]).toBeGreaterThanOrEqual(0);
    }
  });

  it('accepts an override vector for exercising the seam without a DB', async () => {
    const riskHeavy: AttentionWeights = {
      risk: 0.8,
      impact: 0.05,
      novelty: 0.05,
      complexity: 0.05,
      confidence: 0.05,
    };
    const weights = await new StaticWeightsAdapter(riskHeavy).getActiveWeights();
    expect(weights.risk).toBe(0.8);
  });
});

describe('computePriority with a custom weight vector', () => {
  it('changes the priority when the weight vector changes', () => {
    const highRisk: FactorScores = {
      risk: 0.9,
      impact: 0.5,
      novelty: 0.5,
      complexity: 0.5,
      confidenceScore: 0.5,
    };
    const riskHeavy: AttentionWeights = {
      risk: 0.8,
      impact: 0.05,
      novelty: 0.05,
      complexity: 0.05,
      confidence: 0.05,
    };

    const placeholder = computePriority(highRisk, []);
    const fitted = computePriority(highRisk, [], riskHeavy);
    expect(placeholder).not.toBeNull();
    expect(fitted).not.toBeNull();
    // Risk-heavy weights raise the priority of a high-risk assessment.
    expect(fitted!).toBeGreaterThan(placeholder!);
  });
});
