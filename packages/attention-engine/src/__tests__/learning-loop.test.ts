/**
 * Learning-loop tests (day-31 §3.5 acceptance).
 *
 * Five claims, one per acceptance criterion:
 * 1. New decision data triggers a fit (the job runs collect → fit → gate and
 *    carries the candidate).
 * 2. The candidate carries full provenance (window review ids + fit config +
 *    candidate + promotion).
 * 3. HOLD never promotes (no improvement, or judge-signal domination).
 * 4. PROMOTE requires a measured WIN (improvement AND a balanced judge signal).
 * 5. The APPROVE/REJECT gate is untouched: the loop's only human signal is the
 *    usefulness mark (`was_useful`), and neither the collector nor the job reads
 *    or writes any decision state.
 *
 * All seams are fakes — no DB, no LLM, no evaluation import (boundary R4). The
 * collector/gate/job unit logic is the thing under test; the real `fitJudgeWeights`
 * is bound across the boundary by the app-host demo, not here.
 */

import { describe, expect, it } from 'vitest';

import { CalibrationJob, DEFAULT_LEARNING_FIT_CONFIG } from '../learning/calibration-job.js';
import {
  buildLearningWindow,
  judgeDisagreement,
  selectNewSince,
  toLearningSample,
} from '../learning/collector.js';
import { decidePromotion } from '../learning/promotion-gate.js';
import type { CollectSeam, FitSeam, LearningCandidate, ReviewFact } from '../learning/types.js';
import { PRIORITY_WEIGHTS } from '../types.js';

function makeFact(reviewId: string, overrides: Partial<ReviewFact> = {}): ReviewFact {
  return {
    reviewId,
    factors: { risk: 0.7, impact: 0.4, novelty: 0.5, complexity: 0.3, confidence: 0.6 },
    judge: { severityAgreement: 0.8, routingAgreement: 0.9 },
    wasUseful: true,
    recordedAt: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    candidateWeights: PRIORITY_WEIGHTS,
    incumbentWeights: PRIORITY_WEIGHTS,
    improvement: false,
    judgeSignalDominates: false,
    candidateRankingAccuracy: 0.9,
    incumbentRankingAccuracy: 0.9,
    candidateLogLoss: 0.3,
    incumbentLogLoss: 0.3,
    sampleCount: 2,
    ...overrides,
  };
}

function makeCollect(facts: readonly ReviewFact[] = []): CollectSeam {
  return { collect: async () => facts };
}

function makeFit(candidate: LearningCandidate): FitSeam {
  return { fit: () => candidate };
}

describe('collector', () => {
  it('derives judge disagreement as 1 − mean(severity, routing)', () => {
    expect(judgeDisagreement({ severityAgreement: 0.8, routingAgreement: 0.9 })).toBeCloseTo(0.15);
    expect(judgeDisagreement({ severityAgreement: 1, routingAgreement: 1 })).toBeCloseTo(0);
  });

  it('selectNewSince keeps only facts at-or-after the cursor, and null selects all', () => {
    const facts = [
      makeFact('a', { recordedAt: new Date('2026-08-01T00:00:00Z') }),
      makeFact('b', { recordedAt: new Date('2026-08-10T00:00:00Z') }),
    ];
    expect(selectNewSince(facts, null)).toHaveLength(2);
    const fresh = selectNewSince(facts, new Date('2026-08-10T00:00:00Z'));
    expect(fresh.map((f) => f.reviewId)).toEqual(['b']);
  });

  it('maps the usefulness mark to the binary label (never a decision enum)', () => {
    expect(toLearningSample(makeFact('a', { wasUseful: true })).label).toBe(1);
    expect(toLearningSample(makeFact('a', { wasUseful: false })).label).toBe(0);
  });

  it('puts 1−confidence in the incumbent slot and judge disagreement in the judge slot', () => {
    const sample = toLearningSample(
      makeFact('a', {
        factors: { risk: 0.1, impact: 0.2, novelty: 0.3, complexity: 0.4, confidence: 0.9 },
      }),
    );
    expect(sample.incumbentFeatures.slice(0, 4)).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(sample.incumbentFeatures[4]).toBeCloseTo(0.1); // 1 − 0.9
    // judge disagreement = 1 − (0.8+0.9)/2 = 0.15
    expect(sample.judgeFeatures[4]).toBeCloseTo(0.15);
    expect(sample.judgeFeatures.slice(0, 4)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('buildLearningWindow sorts by review id for reproducibility', () => {
    const { reviewIds, samples } = buildLearningWindow([makeFact('z'), makeFact('a')]);
    expect(reviewIds).toEqual(['a', 'z']);
    expect(samples.map((s) => s.reviewId)).toEqual(['a', 'z']);
  });
});

describe('promotion gate', () => {
  it('HOLDs when there is no measured improvement', () => {
    const decision = decidePromotion(makeCandidate({ improvement: false }));
    expect(decision.outcome).toBe('HOLD');
  });

  it('HOLDs when the judge signal dominates, even with an improvement', () => {
    const decision = decidePromotion(
      makeCandidate({ improvement: true, judgeSignalDominates: true }),
    );
    expect(decision.outcome).toBe('HOLD');
  });

  it('PROMOTEs only on a measured WIN with a balanced judge signal', () => {
    const decision = decidePromotion(
      makeCandidate({ improvement: true, judgeSignalDominates: false }),
    );
    expect(decision.outcome).toBe('PROMOTE');
    expect(decision.reasons).not.toHaveLength(0);
  });
});

describe('CalibrationJob', () => {
  it('returns a no-op run (null candidate, not promoted) on an empty window', async () => {
    const job = new CalibrationJob(makeCollect([]), makeFit(makeCandidate()), PRIORITY_WEIGHTS);
    const run = await job.run();
    expect(run.candidate).toBeNull();
    expect(run.promotion).toBeNull();
    expect(run.promoted).toBe(false);
    expect(run.window.reviewIds).toEqual([]);
  });

  it('fits only the fresh window and carries full provenance', async () => {
    const candidate = makeCandidate({ sampleCount: 1, improvement: true });
    let receivedSamples = 0;
    const fit: FitSeam = {
      fit: (samples) => {
        receivedSamples = samples.length;
        return candidate;
      },
    };
    const facts = [
      makeFact('a', { recordedAt: new Date('2026-08-01T00:00:00Z') }),
      makeFact('b', { recordedAt: new Date('2026-08-15T00:00:00Z') }),
    ];
    const job = new CalibrationJob(
      makeCollect(facts),
      fit,
      PRIORITY_WEIGHTS,
      DEFAULT_LEARNING_FIT_CONFIG,
      decidePromotion,
    );
    const run = await job.run(new Date('2026-08-14T00:00:00Z'));

    expect(run.window.reviewIds).toEqual(['b']); // only the fresh fact
    expect(receivedSamples).toBe(1); // only the fresh fact was fit
    expect(run.candidate).toBe(candidate);
    expect(run.fitConfig).toBe(DEFAULT_LEARNING_FIT_CONFIG);
    expect(run.promotion?.outcome).toBe('PROMOTE');
    expect(run.promoted).toBe(true);
  });

  it('never promotes on a HOLD candidate', async () => {
    const job = new CalibrationJob(
      makeCollect([makeFact('a')]),
      makeFit(makeCandidate({ improvement: false })),
      PRIORITY_WEIGHTS,
    );
    const run = await job.run();
    expect(run.promotion?.outcome).toBe('HOLD');
    expect(run.promoted).toBe(false);
  });
});
