/**
 * Coverage + class-balance report (day-11 §3.3).
 *
 * Purely descriptive: given a fit-ready row set it reports how many assessments
 * carry a `was_useful` label, how many are missing it, and the class balance
 * across both labels. It never changes a row — a null `was_useful` is a finding
 * (reviewers aren't giving feedback, or decisions lack the field), surfaced as a
 * spec-governance note when the null share crosses the threshold (day-11 §2.2).
 */

import type { CalibrationRow } from './extractor.js';

/** Null-share ceiling above which Week 3 must fit on the outcome label instead. */
export const NULL_SHARE_THRESHOLD = 0.4;

export interface CoverageReport {
  readonly total: number;
  readonly withFeedback: number;
  readonly withNullFeedback: number;
  /** Share of rows with `was_useful IS NULL`, in `[0, 1]`. */
  readonly nullShare: number;
  /** Row counts by `labelSource` (`feedback` vs `outcome`). */
  readonly byLabelSource: Record<string, number>;
  /** Row counts by objective `outcome`. */
  readonly byOutcome: Record<string, number>;
  /** The `was_useful` class balance. */
  readonly byWasUseful: {
    readonly useful: number;
    readonly notUseful: number;
    readonly null: number;
  };
  /** Spec-10 governance note, emitted when the null share exceeds the threshold. */
  readonly governanceNote?: string;
}

export function computeCoverage(rows: readonly CalibrationRow[]): CoverageReport {
  let useful = 0;
  let notUseful = 0;
  let withNullFeedback = 0;
  const byLabelSource: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};

  for (const row of rows) {
    if (row.wasUseful === true) useful += 1;
    else if (row.wasUseful === false) notUseful += 1;
    else withNullFeedback += 1;

    byLabelSource[row.labelSource] = (byLabelSource[row.labelSource] ?? 0) + 1;
    byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + 1;
  }

  const nullShare = rows.length === 0 ? 0 : withNullFeedback / rows.length;

  return {
    total: rows.length,
    withFeedback: useful + notUseful,
    withNullFeedback,
    nullShare,
    byLabelSource,
    byOutcome,
    byWasUseful: { useful, notUseful, null: withNullFeedback },
    ...(nullShare > NULL_SHARE_THRESHOLD
      ? {
          governanceNote: `was_useful null share ${(nullShare * 100).toFixed(1)}% exceeds ${(
            NULL_SHARE_THRESHOLD * 100
          ).toFixed(0)}% — fit on the outcome label (Spec 10 §4.2)`,
        }
      : {}),
  };
}
