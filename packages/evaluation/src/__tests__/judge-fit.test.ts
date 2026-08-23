/**
 * Judge-signal weight-fit tests (day-23 §3.5, §5). Pure — no DB in the compute.
 *
 * Pins the candidate-fit semantics: a predictive judge signal beats a
 * non-predictive incumbent and concentrates the fitted weight on the judge
 * column (the day-23 §2.3 overfit alarm), the incumbent is passed through
 * unchanged (no default flip), and the before/after monitor renders an
 * `uplift`/`hold` verdict with a governance note.
 */

import { describe, expect, it } from 'vitest';

import { fitJudgeWeights, PLACEHOLDER_WEIGHTS } from '../calibration/weight-fitter.js';
import type {
  FitConfig,
  FitSample,
  JudgeAugmentedSample,
  JudgeFitResult,
  Split,
} from '../calibration/weight-fitter.js';
import { buildJudgeFitReport, JUDGE_FIT_METHOD } from '../calibration/judge-fit-report.js';
import {
  attentionWeightVariants,
  CANDIDATE_ATTENTION_VARIANT_ID,
  INCUMBENT_ATTENTION_VARIANT_ID,
  toAttentionWeights,
} from '../ab/attention-variants.js';

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

/**
 * The incumbent's attention factors are pure noise (no judge signal available),
 * while the judge-augmented column (`confidence` slot) cleanly separates the
 * usefulness label — the "judge would have helped" case (day-23 §2.1).
 */
function judgePredictiveSamples(count = 200): JudgeAugmentedSample[] {
  return Array.from({ length: count }, (_, index) => {
    const useful = index % 2 === 0;
    const judgeDisagreement = useful ? 0.8 : 0.2;
    return {
      incumbentFeatures: [0.5, noise(index, 7), noise(index, 13), noise(index, 17), 0.5],
      judgeFeatures: [0.5, noise(index, 7), noise(index, 13), noise(index, 17), judgeDisagreement],
      label: useful ? 1 : 0,
    };
  });
}

describe('fitJudgeWeights', () => {
  it('throws on an empty sample set', () => {
    expect(() => fitJudgeWeights([], CONFIG)).toThrow(/at least one sample/);
  });

  it('lets a predictive judge signal beat a non-predictive incumbent', () => {
    const result = fitJudgeWeights(judgePredictiveSamples(), CONFIG);

    expect(result.improvement).toBe(true);
    // The candidate ranks usefulness decisively better on held-out rows.
    expect(result.candidate.rankingAccuracy).toBeGreaterThan(result.incumbent.rankingAccuracy);
  });

  it('emits a convex-combination candidate weight vector', () => {
    const result = fitJudgeWeights(judgePredictiveSamples(), CONFIG);
    const w = result.candidateWeights;
    const sum = w.risk + w.impact + w.novelty + w.complexity + w.confidence;

    expect(sum).toBeCloseTo(1, 3);
    for (const value of [w.risk, w.impact, w.novelty, w.complexity, w.confidence]) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('flags the overfit alarm when the judge column dominates the fit', () => {
    const result = fitJudgeWeights(judgePredictiveSamples(), CONFIG);

    expect(result.judgeSignalDominates).toBe(true);
    expect(result.candidateWeights.confidence).toBeGreaterThan(result.candidateWeights.risk);
    expect(result.candidateWeights.confidence).toBeGreaterThan(result.candidateWeights.impact);
    expect(result.candidateWeights.confidence).toBeGreaterThan(result.candidateWeights.novelty);
    expect(result.candidateWeights.confidence).toBeGreaterThan(result.candidateWeights.complexity);
  });

  it('passes the incumbent through unchanged and returns a distinct candidate', () => {
    const result = fitJudgeWeights(judgePredictiveSamples(), CONFIG);

    expect(result.incumbentWeights).toBe(PLACEHOLDER_WEIGHTS);
    expect(result.candidateWeights).not.toBe(PLACEHOLDER_WEIGHTS);
  });
});

describe('no default flip (day-23 §5)', () => {
  it('leaves PLACEHOLDER_WEIGHTS untouched after a fit', () => {
    fitJudgeWeights(judgePredictiveSamples(), CONFIG);

    expect(PLACEHOLDER_WEIGHTS).toEqual({
      risk: 0.35,
      impact: 0.25,
      novelty: 0.15,
      complexity: 0.1,
      confidence: 0.15,
    });
  });
});

/** A fabricated fit result so the pure report mapping is tested, not re-fit. */
function reportFixture(over: Partial<JudgeFitResult> = {}): JudgeFitResult {
  const sample: FitSample = { features: [0, 0, 0, 0, 0], label: 0 };
  const split: Split = {
    train: [sample, sample, sample],
    validation: [sample, sample],
    trainIndices: [0, 1, 2],
    validationIndices: [3, 4],
  };
  return {
    split,
    bias: 0,
    coefficients: [0, 0, 0, 0, 0],
    incumbentWeights: PLACEHOLDER_WEIGHTS,
    candidateWeights: { risk: 0.2, impact: 0.2, novelty: 0.2, complexity: 0.1, confidence: 0.3 },
    incumbent: { logLoss: 0.7, rankingAccuracy: 0.5 },
    candidate: { logLoss: 0.6, rankingAccuracy: 0.8 },
    improvement: true,
    judgeSignalDominates: false,
    ...over,
  };
}

describe('buildJudgeFitReport (before/after inflation monitor)', () => {
  it('renders an uplift verdict when the refit beats the incumbent', () => {
    const report = buildJudgeFitReport(reportFixture(), CONFIG);

    expect(report.verdict).toBe('uplift');
    expect(report.governanceNote).toContain('Day-25');
    expect(report.judgeSignalDominates).toBe(false);
    expect(report.before.rankingAccuracy).toBe(0.5);
    expect(report.after.rankingAccuracy).toBe(0.8);
    expect(report.trainCount).toBe(3);
    expect(report.validationCount).toBe(2);
  });

  it('holds when the refit does not improve', () => {
    const report = buildJudgeFitReport(reportFixture({ improvement: false }), CONFIG);

    expect(report.verdict).toBe('hold');
    expect(report.governanceNote).toContain('did not beat');
  });

  it('holds on the overfit alarm even when the refit nominally improves', () => {
    const report = buildJudgeFitReport(reportFixture({ judgeSignalDominates: true }), CONFIG);

    expect(report.verdict).toBe('hold');
    expect(report.governanceNote).toContain('overfit');
  });

  it('carries the judge-signal fit method', () => {
    expect(JUDGE_FIT_METHOD).toBe('logistic-regression-v0/softmax/judge-signal');
    expect(buildJudgeFitReport(reportFixture(), CONFIG).method).toBe(JUDGE_FIT_METHOD);
  });
});

describe('attentionWeightVariants (candidate as an A/B variant)', () => {
  it('declares the incumbent and candidate with distinct stable ids', () => {
    const candidate = fitJudgeWeights(judgePredictiveSamples(), CONFIG).candidateWeights;
    const pair = attentionWeightVariants(PLACEHOLDER_WEIGHTS, candidate);

    expect(pair.incumbent.variantId).toBe(INCUMBENT_ATTENTION_VARIANT_ID);
    expect(pair.candidate.variantId).toBe(CANDIDATE_ATTENTION_VARIANT_ID);
    expect(pair.incumbent.variantId).not.toBe(pair.candidate.variantId);
  });

  it('leaves the incumbent at the placeholder weights (unchanged)', () => {
    const pair = attentionWeightVariants(PLACEHOLDER_WEIGHTS, {
      risk: 0.1,
      impact: 0.1,
      novelty: 0.1,
      complexity: 0.1,
      confidence: 0.6,
    });

    expect(pair.incumbent.attentionWeights).toEqual({
      risk: 0.35,
      impact: 0.25,
      novelty: 0.15,
      complexity: 0.1,
      confidence: 0.15,
    });
    expect(pair.incumbent.contextRanker).toBe('keyword');
  });

  it('maps the candidate weights into the harness AttentionWeights shape', () => {
    const candidate = { risk: 0.1, impact: 0.1, novelty: 0.1, complexity: 0.1, confidence: 0.6 };
    const pair = attentionWeightVariants(PLACEHOLDER_WEIGHTS, candidate);

    expect(pair.candidate.attentionWeights).toEqual(toAttentionWeights(candidate));
    expect(pair.candidate.contextRanker).toBe('keyword');
  });
});
