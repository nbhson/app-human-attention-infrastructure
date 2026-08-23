/**
 * Promotion gate (day-31 §3.3) — the measured A/B guardrail the loop must clear.
 *
 * A candidate becomes eligible to *promote* **only** by winning its held-out
 * comparison against the incumbent, and never by being newer. Two things block an
 * otherwise-improving candidate:
 *
 * - **No measured improvement** — the candidate did not rank usefulness strictly
 *   better than the incumbent on held-out rows (LOSS or tie ⇒ HOLD).
 * - **Judge signal dominates** — the judge-disagreement column took the strictly
 *   largest fitted weight, the overfit alarm from day-23 §2.3/§6. A fit that has
 *   learned "trust the judge over everything" is untrustworthy even when its
 *   ranking improved, so it holds.
 *
 * This is the day-31 §2.2 invariant made executable: automation extends to
 * *fitting + proposing*, never to unmeasured promotion. `PROMOTE` here means
 * "eligible to be applied" — the caller still performs the apply step explicitly.
 */

import type { LearningCandidate, PromotionDecision } from './types.js';

/**
 * Decide PROMOTE/HOLD for a fitted candidate. Pure: same candidate ⇒ same
 * decision. A candidate is eligible iff it measured a ranking WIN and did not trip
 * the judge-dominance alarm.
 */
export function decidePromotion(candidate: LearningCandidate): PromotionDecision {
  if (!candidate.improvement) {
    return {
      outcome: 'HOLD',
      reasons: ['no measured ranking improvement over the incumbent on held-out rows'],
    };
  }
  if (candidate.judgeSignalDominates) {
    return {
      outcome: 'HOLD',
      reasons: ['judge-disagreement column dominates the fit — overfit alarm (day-23 §6)'],
    };
  }
  return {
    outcome: 'PROMOTE',
    reasons: ['measured ranking WIN over the incumbent (held-out), judge signal balanced'],
  };
}
