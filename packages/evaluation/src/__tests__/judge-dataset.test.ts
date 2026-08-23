/**
 * Judge-dataset tests (day-23 §3.5). Pure — no DB in the compute path.
 *
 * Pins the join semantics: the inner-join drops a review that lacks any one of
 * factors / judge scores / a usefulness mark, the disagreement feature is the
 * severity+routing mean deficit, and the fit samples carry both the incumbent's
 * `(1 − confidence)` and the judge-augmented `judgeDisagreement` in the same
 * slot.
 */

import { describe, expect, it } from 'vitest';

import type { JudgeScores } from '@harness/domain';

import type { FactorScores } from '../calibration/extractor.js';
import {
  buildJudgeDataset,
  judgeDisagreement,
  toJudgeFeatureVector,
  toJudgeFitSamples,
} from '../calibration/judge-dataset.js';
import type { JudgeDatasetInput } from '../calibration/judge-dataset.js';

function factors(over: Partial<FactorScores> = {}): FactorScores {
  return { risk: 0.8, impact: 0.7, novelty: 0.6, complexity: 0.5, confidence: 0.9, ...over };
}

function judge(severity: number, routing: number): JudgeScores {
  return {
    severityAgreement: severity,
    routingAgreement: routing,
    evidenceSufficiency: 0.9,
    overall: 0.8,
  };
}

describe('judgeDisagreement', () => {
  it('is 1 − mean(severityAgreement, routingAgreement)', () => {
    expect(judgeDisagreement(judge(0.8, 0.6))).toBeCloseTo(0.3);
  });

  it('is 0 for a fully-agreeing judge and 1 for a fully-disagreeing one', () => {
    expect(judgeDisagreement(judge(1, 1))).toBe(0);
    expect(judgeDisagreement(judge(0, 0))).toBe(1);
  });
});

describe('buildJudgeDataset', () => {
  it('inner-joins only reviews with factors + judge + a usefulness mark', () => {
    const input: JudgeDatasetInput = {
      factors: new Map([
        ['r1', factors({ risk: 0.1 })],
        ['r2', factors({ risk: 0.2 })],
        ['r3', factors({ risk: 0.3 })],
      ]),
      judge: new Map([
        ['r1', judge(0.8, 0.6)],
        ['r2', judge(1, 1)], // r2 has no feedback
      ]),
      feedback: new Map([
        ['r1', true],
        ['r3', false], // r3 has no judge
      ]),
    };

    const rows = buildJudgeDataset(input);

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.reviewId).toBe('r1');
    expect(row.wasUseful).toBe(true);
    expect(row.judgeDisagreement).toBeCloseTo(0.3);
    expect(row.judge).toEqual(judge(0.8, 0.6));
    expect(row.factors.risk).toBe(0.1);
  });

  it('sorts the output by review id for reproducibility', () => {
    const input: JudgeDatasetInput = {
      factors: new Map([
        ['b', factors({ risk: 0.1 })],
        ['a', factors({ risk: 0.2 })],
      ]),
      judge: new Map([
        ['b', judge(0.5, 0.5)],
        ['a', judge(0.5, 0.5)],
      ]),
      feedback: new Map([
        ['b', true],
        ['a', false],
      ]),
    };

    expect(buildJudgeDataset(input).map((row) => row.reviewId)).toEqual(['a', 'b']);
  });
});

describe('toJudgeFeatureVector', () => {
  it('places judgeDisagreement in the confidence slot, factors in the first four', () => {
    const vector = toJudgeFeatureVector(factors(), judge(0.8, 0.6));
    expect(vector.slice(0, 4)).toEqual([0.8, 0.7, 0.6, 0.5]);
    expect(vector[4]).toBeCloseTo(judgeDisagreement(judge(0.8, 0.6)));
  });
});

describe('toJudgeFitSamples', () => {
  it('builds the incumbent (1−confidence) and judge-augmented feature pair per row', () => {
    const input: JudgeDatasetInput = {
      factors: new Map([['r1', factors()]]), // confidence 0.9 → incumbent slot 4 = 0.1
      judge: new Map([['r1', judge(0.8, 0.6)]]), // disagreement 0.3
      feedback: new Map([['r1', true]]),
    };
    const rows = buildJudgeDataset(input);
    const samples = toJudgeFitSamples(rows);

    expect(samples).toHaveLength(1);
    const sample = samples[0]!;
    expect(sample.label).toBe(1);
    expect(sample.incumbentFeatures.slice(0, 4)).toEqual([0.8, 0.7, 0.6, 0.5]);
    expect(sample.incumbentFeatures[4]).toBeCloseTo(0.1); // 1 − confidence 0.9
    expect(sample.judgeFeatures.slice(0, 4)).toEqual([0.8, 0.7, 0.6, 0.5]);
    expect(sample.judgeFeatures[4]).toBeCloseTo(0.3); // judge disagreement
  });
});
