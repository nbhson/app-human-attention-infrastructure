/**
 * Judge-signal calibration dataset (day-23 §3.1) — the join that turns review
 * usefulness into fit-ready rows.
 *
 * The Phase-2 fitter learns the five attention weights from the human's
 * `was_useful` label alone, so it is blind to whether a *judge* (day-21/22)
 * thought the review itself was high quality. Day 23 adds that signal: per
 * review, join the human's usefulness mark with the judge's severity/routing
 * agreement and the attention engine's factor scores into one row, and surface
 * the judge's verdict as a *feature* (`judgeDisagreement`) so a refit can learn
 * how much to trust judge-flagged disagreement when predicting usefulness.
 *
 * This module is **pure**: it takes already-keyed records and returns rows, with
 * no `Date.now()`, no `Math.random()`, and no I/O — the DB reads/writes live in
 * the Phase-2 CLI + writer, and aligning each record to the same review id is a
 * caller concern (the same id across all three maps).
 *
 * Label/feature contract (day-23 §6): `was_useful` is the **label**; judge scores
 * are a **feature**. Never inverted — the judge predicts, the human decides.
 */

import type { JudgeScores } from '@harness/domain';

import type { FactorScores } from './extractor.js';
import { toFeatureVector } from './weight-fitter.js';
import type { JudgeAugmentedSample } from './weight-fitter.js';

/**
 * Derive the judge disagreement for a report: `1 − mean(severityAgreement,
 * routingAgreement)` — the two dimensions day-23 §2.1 names. A low agreement
 * (the judge thinks severity is mis-rated or the report routed the wrong PR) is
 * a *higher* disagreement, so this enters the fit as a positive "needs more
 * attention" signal, in the confidence-deficit slot.
 */
export function judgeDisagreement(judge: JudgeScores): number {
  return 1 - (judge.severityAgreement + judge.routingAgreement) / 2;
}

/** One review's aligned inputs, all keyed by the same review id. */
export interface JudgeDatasetInput {
  readonly factors: ReadonlyMap<string, FactorScores>;
  readonly judge: ReadonlyMap<string, JudgeScores>;
  readonly feedback: ReadonlyMap<string, boolean>;
}

/** One fit-ready row: factors + the judge signal + the human's usefulness label. */
export interface JudgeDatasetRow {
  readonly reviewId: string;
  readonly factors: FactorScores;
  readonly judge: JudgeScores;
  /** `1 − mean(severityAgreement, routingAgreement)`, in `[0,1]`. */
  readonly judgeDisagreement: number;
  readonly wasUseful: boolean;
}

/**
 * Inner-join the three input sets by review id. A review that lacks any one of
 * factors, judge scores, or a usefulness mark is excluded — a row without all
 * three cannot be fit. The output is key-sorted so it is reproducible for the
 * same input.
 */
export function buildJudgeDataset(input: JudgeDatasetInput): JudgeDatasetRow[] {
  const keys = [...input.factors.keys()].filter(
    (reviewId) => input.judge.has(reviewId) && input.feedback.has(reviewId),
  );
  keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keys.map((reviewId) => {
    const judge = input.judge.get(reviewId)!;
    return {
      reviewId,
      factors: input.factors.get(reviewId)!,
      judge,
      judgeDisagreement: judgeDisagreement(judge),
      wasUseful: input.feedback.get(reviewId)!,
    };
  });
}

/**
 * The five judge-augmented features: the confidence column is replaced by the
 * judge disagreement (`[risk, impact, novelty, complexity, judgeDisagreement]`),
 * matching how the incumbent's `toFeatureVector` puts `(1 − confidence)` in that
 * slot. The candidate weight vector therefore keeps the engine's 5-factor shape
 * and is directly consumable by `computePriority`.
 */
export function toJudgeFeatureVector(factors: FactorScores, judge: JudgeScores): number[] {
  return [factors.risk, factors.impact, factors.novelty, factors.complexity, judgeDisagreement(judge)];
}

/** The incumbent's factor features; slot 4 is `(1 − confidence)`. */
function incumbentFeatures(factors: FactorScores): number[] {
  return toFeatureVector(factors);
}

/**
 * Turn joined rows into the {@link JudgeAugmentedSample}s the `fitJudgeWeights`
 * before/after fit consumes: each row contributes both the incumbent's own
 * feature vector (attention factors only) and the judge-augmented vector, plus
 * the usefulness label.
 */
export function toJudgeFitSamples(rows: readonly JudgeDatasetRow[]): JudgeAugmentedSample[] {
  return rows.map((row) => ({
    incumbentFeatures: incumbentFeatures(row.factors),
    judgeFeatures: toJudgeFeatureVector(row.factors, row.judge),
    label: row.wasUseful ? 1 : 0,
  }));
}
