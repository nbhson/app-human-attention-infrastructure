import { describe, expect, it } from 'vitest';

import { computePriority, labelFor, weightSum } from '../scoring.js';
import type { FactorScores } from '../types.js';

const BASE: FactorScores = {
  risk: 0.5,
  impact: 0.5,
  novelty: 0.5,
  complexity: 0.5,
  confidenceScore: 0.5,
};

describe('computePriority', () => {
  it('inverts confidence: high confidence yields LOWER priority (v0.1 regression)', () => {
    const highConfidence = computePriority({ ...BASE, confidenceScore: 0.9 }, []);
    const lowConfidence = computePriority({ ...BASE, confidenceScore: 0.2 }, []);
    expect(highConfidence).not.toBeNull();
    expect(lowConfidence).not.toBeNull();
    expect(highConfidence!).toBeLessThan(lowConfidence!);
  });

  it('redistributes unavailable factor weights without using the 0.5 placeholder', () => {
    const f: FactorScores = {
      risk: 0.6,
      impact: 0.5,
      novelty: 0.5,
      complexity: 0.5,
      confidenceScore: 0.5,
    };
    const priority = computePriority(f, ['impact', 'novelty', 'complexity']);
    // Available: risk (w .35 · 0.6) + confidence (w .15 · (1 − 0.5)) over wTotal .50.
    // raw = 0.21 + 0.075 = 0.285 → 0.285 / 0.50 = 0.57.
    expect(priority).toBeCloseTo(0.57, 6);
  });

  it('uses (1 − confidence_score) inside the raw sum', () => {
    // Only confidence available: priority = w·(1 − v) / w = 1 − v.
    const priority = computePriority(BASE, ['risk', 'impact', 'novelty', 'complexity']);
    expect(priority).toBeCloseTo(1 - BASE.confidenceScore, 6);
  });

  it('returns null when every factor is unavailable', () => {
    const none = computePriority(BASE, ['risk', 'impact', 'novelty', 'complexity', 'confidence']);
    expect(none).toBeNull();
  });
});

describe('labelFor', () => {
  it('maps the exact boundaries from the spec', () => {
    expect(labelFor(0.8)).toBe('CRITICAL');
    expect(labelFor(0.79)).toBe('HIGH');
    expect(labelFor(0.6)).toBe('HIGH');
    expect(labelFor(0.59)).toBe('MEDIUM');
    expect(labelFor(0.3)).toBe('MEDIUM');
    expect(labelFor(0.29)).toBe('LOW');
  });
});

describe('weightSum', () => {
  it('sums the placeholder weights to 1.0 (static assertion)', () => {
    expect(weightSum()).toBeCloseTo(1, 6);
  });
});
