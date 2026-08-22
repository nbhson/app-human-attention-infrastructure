/**
 * Pure tests for the Day-29 outcome metrics (day-29 §2.3, §2.4, §5).
 *
 * Kendall tau, the rank_correlation distribution, the three arm-specific
 * outcome signals, the minimum-evidence bar, and the Day-30 recommendation.
 */

import { describe, expect, it } from 'vitest';

import {
  aggregateSignals,
  DEFAULT_EVIDENCE_BAR,
  evaluateEvidence,
  kendallTau,
  rankCorrelationDistribution,
  recommend,
} from '../ab/outcome-metrics.js';
import type {
  EvidenceVerdict,
  OutcomeSignals,
  RankCorrelationDistribution,
} from '../ab/outcome-metrics.js';

describe('kendallTau', () => {
  it('is 1 for identical orders, -1 for reversed, null under 2 shared items', () => {
    expect(kendallTau(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
    expect(kendallTau(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(-1);
    expect(kendallTau(['a'], ['a'])).toBeNull();
    expect(kendallTau(['a', 'b'], ['a', 'b'])).toBe(1);
  });

  it('ignores items present in only one ordering', () => {
    expect(kendallTau(['a', 'b', 'c'], ['a', 'b'])).toBe(1);
    expect(kendallTau(['a', 'b', 'c'], ['b', 'a'])).toBe(-1);
  });
});

describe('rankCorrelationDistribution', () => {
  it('assembles one tau per input into a distribution with mean/min/max', () => {
    const dist = rankCorrelationDistribution(
      [
        ['a', 'b', 'c'],
        ['x', 'y', 'z'],
      ],
      [
        ['c', 'b', 'a'],
        ['x', 'y', 'z'],
      ],
      3,
    );
    expect(dist.values).toEqual([-1, 1]);
    expect(dist.count).toBe(2);
    expect(dist.mean).toBe(0);
    expect(dist.min).toBe(-1);
    expect(dist.max).toBe(1);
  });

  it('omits stats when no input produced a computable tau', () => {
    const dist = rankCorrelationDistribution([['a']], [['a']], 3);
    expect(dist.values).toEqual([]);
    expect(dist.count).toBe(0);
    expect(dist.mean).toBeUndefined();
    expect(dist.min).toBeUndefined();
    expect(dist.max).toBeUndefined();
  });
});

describe('aggregateSignals', () => {
  it('computes acceptance (precision), rework (recall-miss), and dwell over inputs', () => {
    const signals = aggregateSignals([
      { injectedOrder: ['a', 'b'], consumedPaths: ['a', 'b'], topK: 2, elapsedMinutes: 10 },
    ]);
    expect(signals.contextAcceptanceRate).toBe(1);
    expect(signals.reworkRate).toBe(0);
    expect(signals.humanMinutesPerAccept).toBe(10);
  });

  it('flags a re-route when a consumed file misses the top-k and inflates dwell', () => {
    const signals = aggregateSignals([
      { injectedOrder: ['a'], consumedPaths: ['a', 'b'], topK: 1, elapsedMinutes: 10 },
    ]);
    expect(signals.contextAcceptanceRate).toBe(1); // injected set {a} ⊆ consumed
    expect(signals.reworkRate).toBe(1);
    expect(signals.humanMinutesPerAccept).toBe(15); // 10 * (1 + 1/2)
  });

  it('returns {} for zero inputs', () => {
    expect(aggregateSignals([])).toEqual({});
  });
});

describe('evaluateEvidence', () => {
  const bar = DEFAULT_EVIDENCE_BAR;

  it('is sufficient when N, disagreement, and non-degeneracy all pass', () => {
    const correlation: RankCorrelationDistribution = {
      values: [-1, -1, 1],
      count: 3,
      mean: -1 / 3,
      min: -1,
      max: 1,
    };
    const verdict = evaluateEvidence(bar, 3, correlation, liveSignals(1), liveSignals(1));
    expect(verdict.verdict).toBe('sufficient');
    expect(verdict.reasons).toEqual([]);
  });

  it('fails the N bar below minTasks', () => {
    const correlation: RankCorrelationDistribution = {
      values: [-1],
      count: 1,
      mean: -1,
      min: -1,
      max: -1,
    };
    const verdict = evaluateEvidence(bar, 1, correlation, liveSignals(1), liveSignals(1));
    expect(verdict.verdict).toBe('insufficient');
    expect(verdict.reasons.some((reason) => reason.includes('below the minimum'))).toBe(true);
  });

  it('fails when no rank_correlation is computable', () => {
    const correlation: RankCorrelationDistribution = { values: [], count: 0 };
    const verdict = evaluateEvidence(bar, 3, correlation, liveSignals(1), liveSignals(1));
    expect(verdict.reasons.some((reason) => reason.includes('rank_correlation'))).toBe(true);
  });

  it('fails when the arms agree too often (disagreement share below the bar)', () => {
    const correlation: RankCorrelationDistribution = {
      values: [1, 1, 1],
      count: 3,
      mean: 1,
      min: 1,
      max: 1,
    };
    const verdict = evaluateEvidence(bar, 3, correlation, liveSignals(1), liveSignals(1));
    expect(verdict.reasons.some((reason) => reason.includes('disagreement'))).toBe(true);
  });

  it('fails when outcome signals are degenerate', () => {
    const correlation: RankCorrelationDistribution = {
      values: [-1, -1],
      count: 2,
      mean: -1,
      min: -1,
      max: -1,
    };
    const verdict = evaluateEvidence(bar, 3, correlation, {}, liveSignals(1));
    expect(verdict.reasons.some((reason) => reason.includes('degenerate'))).toBe(true);
  });
});

describe('recommend', () => {
  const sufficient: EvidenceVerdict = { verdict: 'sufficient', reasons: [] };

  it('keeps shadow on insufficient evidence', () => {
    const insufficient: EvidenceVerdict = { verdict: 'insufficient', reasons: ['N below'] };
    expect(recommend(insufficient, liveSignals(0), liveSignals(1))).toBe('keep-shadow');
  });

  it('promotes when B lowers rework without losing acceptance', () => {
    const a = { contextAcceptanceRate: 0.5, reworkRate: 0.5 };
    const b = { contextAcceptanceRate: 0.5, reworkRate: 0 };
    expect(recommend(sufficient, a, b)).toBe('promote');
  });

  it('keeps shadow when B is strictly worse', () => {
    const a = { contextAcceptanceRate: 1, reworkRate: 0 };
    const b = { contextAcceptanceRate: 0.5, reworkRate: 0.5 };
    expect(recommend(sufficient, a, b)).toBe('keep-shadow');
  });

  it('calls a real A/B on a toss-up (equal rework)', () => {
    const a = { contextAcceptanceRate: 1, reworkRate: 0 };
    const b = { contextAcceptanceRate: 1, reworkRate: 0 };
    expect(recommend(sufficient, a, b)).toBe('real-ab');
  });
});

function liveSignals(scale: number): OutcomeSignals {
  return { contextAcceptanceRate: scale, reworkRate: scale, humanMinutesPerAccept: scale };
}
