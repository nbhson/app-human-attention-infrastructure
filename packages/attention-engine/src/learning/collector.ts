/**
 * Learning collector (day-31 §3.1) — window new review facts into fit-ready samples.
 *
 * This module is **pure**: every function takes plain {@link ReviewFact}s and
 * returns plain values, with no `Date.now()`, no `Math.random()`, and no I/O. The
 * database read that *fetches* the facts lives behind the {@link CollectSeam}; this
 * file only decides **which** of those facts are new and turns them into the
 * {@link LearningSample}s the fitter consumes. That split keeps the loop
 * reproducible and unit-testable with no DB in the compute path.
 *
 * The judge signal enters the candidate's feature vector in the confidence-deficit
 * slot exactly as the engine's own formula does for `confidence` — a *high*
 * disagreement (the judge thinks severity/routing are off) is a positive
 * "needs more attention" signal, so both the incumbent and the candidate keep the
 * same five-slot shape (day-23 §3.1).
 */

import type { ReviewFact, ReviewJudge, LearningSample } from './types.js';

/**
 * The judge disagreement for a report: `1 − mean(severityAgreement,
 * routingAgreement)` — the two dimensions day-23 §2.1 names. Mirrors evaluation's
 * `judgeDisagreement` (this package may not import it, boundary R4).
 */
export function judgeDisagreement(judge: ReviewJudge): number {
  return 1 - (judge.severityAgreement + judge.routingAgreement) / 2;
}

/** The incumbent's feature vector; slot 4 is `(1 − confidence)`. */
function incumbentFeatures(fact: ReviewFact): number[] {
  const { risk, impact, novelty, complexity, confidence } = fact.factors;
  return [risk, impact, novelty, complexity, 1 - confidence];
}

/** The judge-augmented feature vector; slot 4 is the judge disagreement. */
function judgeFeatures(fact: ReviewFact): number[] {
  const { risk, impact, novelty, complexity } = fact.factors;
  return [risk, impact, novelty, complexity, judgeDisagreement(fact.judge)];
}

/** One review fact → one fit-ready sample (the human's mark is the label). */
export function toLearningSample(fact: ReviewFact): LearningSample {
  return {
    reviewId: fact.reviewId,
    incumbentFeatures: incumbentFeatures(fact),
    judgeFeatures: judgeFeatures(fact),
    label: fact.wasUseful ? 1 : 0,
  };
}

/**
 * Select the facts recorded at or after `since`. A `null` cursor means "the very
 * first run" and selects everything; otherwise only fresh evidence is included, so
 * a re-run over unchanged data returns an empty window (the stale-data floor the
 * caller turns into a no-op, day-31 §2.4).
 */
export function selectNewSince(facts: readonly ReviewFact[], since: Date | null): readonly ReviewFact[] {
  if (since === null) {
    return facts;
  }
  const cut = since.getTime();
  return facts.filter((fact) => fact.recordedAt.getTime() >= cut);
}

/** One fit-ready batch: the key-sorted sample list plus its review ids. */
export interface LearningWindow {
  readonly reviewIds: readonly string[];
  readonly samples: readonly LearningSample[];
}

/**
 * Turn a batch of (already-joined) facts into samples, key-sorted by review id so
 * the same input always produces the same order (reproducibility, like the
 * day-23 join). The inner-join of factors × judge × feedback has already happened
 * in the collect seam; this function preserves order and shape.
 */
export function buildLearningWindow(facts: readonly ReviewFact[]): LearningWindow {
  const ordered = [...facts].sort((a, b) => a.reviewId.localeCompare(b.reviewId));
  return {
    reviewIds: ordered.map((fact) => fact.reviewId),
    samples: ordered.map(toLearningSample),
  };
}
