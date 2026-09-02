/**
 * Judge-signal fit report (day-23 §3.4) — the before/after inflation monitor.
 *
 * Phase 2's fit report already refuses to promote a weight vector that did not
 * beat the placeholder. Day 23 adds a second guardrail on top: the judge signal
 * is *new* and arrives on a small N, so a fit that lets the judge-disagreement
 * column dominate the weight vector is an overfit risk even when it nominally
 * improves held-out ranking. This report renders both checks — the `improvement`
 * before/after comparison *and* the `judgeSignalDominates` alarm — into a
 * `uplift`/`hold` verdict with a plain-language governance note.
 */

import type { FitConfig, JudgeFitResult, WeightsVector } from './weight-fitter.js';

/** The fit method string (stable); carries the judge-signal extension. */
export const JUDGE_FIT_METHOD = 'logistic-regression-v0/softmax/judge-signal';

/** The rendered before/after monitor result. */
export interface JudgeFitReport {
  readonly method: string;
  readonly seed: number;
  readonly trainCount: number;
  readonly validationCount: number;
  readonly incumbentWeights: WeightsVector;
  readonly candidateWeights: WeightsVector;
  readonly before: {
    readonly rankingAccuracy: number;
    readonly logLoss: number;
  };
  readonly after: {
    readonly rankingAccuracy: number;
    readonly logLoss: number;
  };
  readonly judgeSignalDominates: boolean;
  readonly verdict: 'uplift' | 'hold';
  readonly governanceNote: string;
}

/** Assemble the before/after monitor from a judge-signal fit. */
export function buildJudgeFitReport(result: JudgeFitResult, config: FitConfig): JudgeFitReport {
  const judgeSignalDominates = result.judgeSignalDominates;
  const verdict: JudgeFitReport['verdict'] = result.improvement && !judgeSignalDominates ? 'uplift' : 'hold';

  let governanceNote: string;
  if (verdict === 'uplift') {
    governanceNote =
      'judge-signal refit routes usefulness better than the incumbent on held-out validation; ' +
      'a Day-25 promotion candidate — no default weight set flipped today';
  } else if (judgeSignalDominates) {
    governanceNote =
      'judge-signal refit lets judge disagreement dominate a single factor — overfit risk on small ' +
      'N; held pending more review labels';
  } else {
    governanceNote = 'judge-signal refit did not beat the incumbent on held-out validation; the incumbent stays active';
  }

  return {
    method: JUDGE_FIT_METHOD,
    seed: config.seed,
    trainCount: result.split.train.length,
    validationCount: result.split.validation.length,
    incumbentWeights: result.incumbentWeights,
    candidateWeights: result.candidateWeights,
    before: result.incumbent,
    after: result.candidate,
    judgeSignalDominates,
    verdict,
    governanceNote,
  };
}
