import { describe, expect, it } from 'vitest';

import type { AgreementDimension, JudgeAgreement } from '@harness/domain';

import type { JudgeFitReport } from '../calibration/judge-fit-report.js';
import { PLACEHOLDER_WEIGHTS } from '../calibration/weight-fitter.js';
import type {
  FitConfig,
  JudgeAugmentedSample,
  WeightsVector,
} from '../calibration/weight-fitter.js';
import {
  buildCalibrationReport,
  renderCalibrationReport,
  runCalibration,
} from '../calibration/calibration-report.js';
import type { GoldAgreementSummary } from '../calibration/calibration-report.js';

function dimension(over: Partial<AgreementDimension> = {}): AgreementDimension {
  return { n: 6, meanAbsDiff: 0.1, agreement: 0.9, kappa: 0.8, ...over };
}

function agreement(over: Partial<JudgeAgreement> = {}): JudgeAgreement {
  return {
    severity: dimension(),
    routing: dimension(),
    evidence: dimension(),
    overall: dimension(),
    ...over,
  };
}

function weights(over: Partial<WeightsVector> = {}): WeightsVector {
  return { ...PLACEHOLDER_WEIGHTS, ...over };
}

/** A fit that beat the incumbent on held-out ranking, without signal dominance. */
function upliftFit(over: Partial<JudgeFitReport> = {}): JudgeFitReport {
  return {
    method: 'logistic-regression-v0/softmax/judge-signal',
    seed: 42,
    trainCount: 4,
    validationCount: 2,
    incumbentWeights: PLACEHOLDER_WEIGHTS,
    candidateWeights: weights({ confidence: 0.25 }),
    before: { rankingAccuracy: 0.5, logLoss: 0.9 },
    after: { rankingAccuracy: 1.0, logLoss: 0.1 },
    judgeSignalDominates: false,
    verdict: 'uplift',
    governanceNote: '',
    ...over,
  };
}

const TRUSTY_GOLD: GoldAgreementSummary = {
  severity: 0.9,
  routing: 0.85,
  usefulness: 0.8,
  n: 6,
};

const CONFIG: FitConfig = {
  seed: 42,
  validationShare: 0.5,
  iterations: 2000,
  learningRate: 0.1,
  regularization: 0.01,
};

describe('buildCalibrationReport', () => {
  it('PROMOTEs when the refit uplifts, the A/B leads, and the judge is trustworthy', () => {
    const report = buildCalibrationReport({
      judgeVsGold: TRUSTY_GOLD,
      interJudge: agreement(),
      judgeFit: upliftFit(),
      corpusVersion: 'v1',
    });

    expect(report.decision).toBe('PROMOTE');
    expect(report.judgeTrustworthy).toBe(true);
    expect(report.ab.go).toBe(true);
    expect(report.ab.metric).toBe('held_out_usefulness_ranking_accuracy');
    expect(report.reasons).toHaveLength(3);
  });

  it('HOLDs when the judge is not trustworthy on judge-vs-gold usefulness', () => {
    const report = buildCalibrationReport({
      judgeVsGold: { ...TRUSTY_GOLD, usefulness: 0.2 },
      interJudge: agreement(),
      judgeFit: upliftFit(),
      corpusVersion: 'v1',
    });

    expect(report.decision).toBe('HOLD');
    expect(report.judgeTrustworthy).toBe(false);
  });

  it('HOLDs when inter-judge severity agreement is below the floor', () => {
    const report = buildCalibrationReport({
      judgeVsGold: TRUSTY_GOLD,
      interJudge: agreement({ severity: dimension({ agreement: 0.5, meanAbsDiff: 0.5 }) }),
      judgeFit: upliftFit(),
      corpusVersion: 'v1',
    });

    expect(report.decision).toBe('HOLD');
    expect(report.judgeTrustworthy).toBe(false);
  });

  it('HOLDs when the refit verdict is already hold (judge signal dominates)', () => {
    const report = buildCalibrationReport({
      judgeVsGold: TRUSTY_GOLD,
      interJudge: agreement(),
      judgeFit: upliftFit({
        verdict: 'hold',
        judgeSignalDominates: true,
        governanceNote: 'judge-disagreement dominates a single factor',
      }),
      corpusVersion: 'v1',
    });

    expect(report.decision).toBe('HOLD');
    expect(report.reasons[0]).toContain('refit verdict HOLD');
  });
});

describe('runCalibration', () => {
  it('recomputes the fit from samples and emits a well-formed report', () => {
    // A judge signal in slot 4 (confidence) that perfectly separates usefulness —
    // almost certain to dominate the fitted weight vector.
    const samples: JudgeAugmentedSample[] = [
      {
        incumbentFeatures: [0.5, 0.5, 0.5, 0.5, 0.5],
        judgeFeatures: [0.5, 0.5, 0.5, 0.5, 0.9],
        label: 1,
      },
      {
        incumbentFeatures: [0.5, 0.5, 0.5, 0.5, 0.5],
        judgeFeatures: [0.5, 0.5, 0.5, 0.5, 0.8],
        label: 1,
      },
      {
        incumbentFeatures: [0.5, 0.5, 0.5, 0.5, 0.5],
        judgeFeatures: [0.5, 0.5, 0.5, 0.5, 0.2],
        label: 0,
      },
      {
        incumbentFeatures: [0.5, 0.5, 0.5, 0.5, 0.4],
        judgeFeatures: [0.5, 0.5, 0.5, 0.5, 0.1],
        label: 0,
      },
    ];

    const report = runCalibration({
      samples,
      config: CONFIG,
      judgeVsGold: TRUSTY_GOLD,
      interJudge: agreement(),
      corpusVersion: 'v1',
    });

    // The judge signal is the only informative feature, so the candidate improves
    // but flags the dominance alarm → the checkpoint holds (the gate worked).
    expect(report.fit.judgeSignalDominates).toBe(true);
    expect(report.fit.verdict).toBe('hold');
    expect(report.decision).toBe('HOLD');
    expect(report.corpusVersion).toBe('v1');
    expect(report.seed).toBe(CONFIG.seed);
  });

  it('rejects an empty sample set', () => {
    expect(() =>
      runCalibration({
        samples: [],
        config: CONFIG,
        judgeVsGold: TRUSTY_GOLD,
        interJudge: agreement(),
        corpusVersion: 'v1',
      }),
    ).toThrow(/at least one judge-augmented sample/);
  });
});

describe('renderCalibrationReport', () => {
  it('surfaces the three agreements, the A/B, and the decision', () => {
    const report = buildCalibrationReport({
      judgeVsGold: TRUSTY_GOLD,
      interJudge: agreement(),
      judgeFit: upliftFit(),
      corpusVersion: 'v1',
    });
    const text = renderCalibrationReport(report);

    expect(text).toContain('judge-vs-gold agreement');
    expect(text).toContain('inter-judge agreement');
    expect(text).toContain('judge-signal refit');
    expect(text).toContain('PROMOTE');
    expect(text).toContain('held_out_usefulness_ranking_accuracy');
    expect(text).toContain('v1');
  });
});
