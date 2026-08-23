/**
 * Inter-judge agreement (day-22 §2.1) — the statistic that makes judge quality
 * itself measurable.
 *
 * Given N matched score pairs (two runs over the same report each), compute a
 * per-dimension agreement: severity and routing drift independently, so a single
 * collapsed scalar would hide a routing drift behind a healthy severity score.
 *
 * For each dimension we report three numbers over the N pairs:
 *  - `meanAbsDiff`  — mean `|a - b|` (0 is perfect agreement),
 *  - `agreement`    — the continuous rate `1 - meanAbsDiff`, and
 *  - `kappa`        — Cohen's κ on the `score >= 0.5` flag, which discounts the
 *    agreement that two raters would show by chance.
 */

import type { AgreementDimension, JudgeAgreement, JudgeScores } from '@harness/domain';

/** A matched pair of judge scores over the same report (day-22 §2.3). */
export interface JudgeScorePair {
  readonly a: JudgeScores;
  readonly b: JudgeScores;
}

/** Binarization threshold for Cohen's κ: a score at/above it is "flagged". */
const FLAG_THRESHOLD = 0.5;

/** A rubric dimension and how to read it out of a {@link JudgeScores}. */
interface Dimension {
  readonly key: keyof JudgeAgreement;
  readonly pick: (scores: JudgeScores) => number;
}

const DIMENSIONS: readonly Dimension[] = [
  { key: 'severity', pick: (s) => s.severityAgreement },
  { key: 'routing', pick: (s) => s.routingAgreement },
  { key: 'evidence', pick: (s) => s.evidenceSufficiency },
  { key: 'overall', pick: (s) => s.overall },
];

/** Cohen's κ for two binary raters from the 2×2 agreement table. */
function cohensKappa(n11: number, n10: number, n01: number, n00: number, n: number): number {
  const observed = (n11 + n00) / n;
  const a1 = n11 + n10;
  const b1 = n11 + n01;
  const a0 = n01 + n00;
  const b0 = n10 + n00;
  const expected = (a1 * b1 + a0 * b0) / (n * n);
  const denominator = 1 - expected;
  // Degenerate: both raters were constant, so chance-agreement is 1.0 and κ is
  // undefined. The convention is κ = 1 for perfect observed agreement, else 0.
  if (denominator <= Number.EPSILON) {
    return observed >= 1 - Number.EPSILON ? 1 : 0;
  }
  return (observed - expected) / denominator;
}

/** Compute one dimension's agreement across the pairs. */
function agreementFor(
  pairs: readonly JudgeScorePair[],
  pick: (scores: JudgeScores) => number,
): AgreementDimension {
  const n = pairs.length;
  let sumAbs = 0;
  let n11 = 0;
  let n10 = 0;
  let n01 = 0;
  let n00 = 0;

  for (const pair of pairs) {
    const a = pick(pair.a);
    const b = pick(pair.b);
    sumAbs += Math.abs(a - b);
    const fa = a >= FLAG_THRESHOLD ? 1 : 0;
    const fb = b >= FLAG_THRESHOLD ? 1 : 0;
    if (fa === 1 && fb === 1) {
      n11 += 1;
    } else if (fa === 1 && fb === 0) {
      n10 += 1;
    } else if (fa === 0 && fb === 1) {
      n01 += 1;
    } else {
      n00 += 1;
    }
  }

  const meanAbsDiff = sumAbs / n;
  return {
    n,
    meanAbsDiff,
    agreement: 1 - meanAbsDiff,
    kappa: cohensKappa(n11, n10, n01, n00, n),
  };
}

/**
 * Compute per-dimension inter-judge agreement across the matched pairs.
 *
 * @throws if `pairs` is empty — agreement over zero pairs is a caller error, not
 * a number.
 */
export function computeAgreement(pairs: readonly JudgeScorePair[]): JudgeAgreement {
  if (pairs.length === 0) {
    throw new Error('computeAgreement requires at least one score pair');
  }
  return {
    severity: agreementFor(pairs, DIMENSIONS[0]!.pick),
    routing: agreementFor(pairs, DIMENSIONS[1]!.pick),
    evidence: agreementFor(pairs, DIMENSIONS[2]!.pick),
    overall: agreementFor(pairs, DIMENSIONS[3]!.pick),
  };
}
