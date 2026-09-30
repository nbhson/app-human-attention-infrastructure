/**
 * Deterministic testing-health override for the review slice.
 *
 * The `testing` dimension of `healthScore` used to be purely AI-assessed, but
 * the model only guesses the test-to-source ratio from the diff text — e.g. a
 * report whose diff carries two `*.spec.ts` files was stored as
 * `testing: poor / testingScore: 1` while the deterministic composition in
 * {@link computeReviewStats} correctly counted `test: 2 files`. The Detail tab
 * renders whatever is stored, so an AI miscount shows up as a wrong score next
 * to a diff that plainly contains tests.
 *
 * This module recomputes the `testing` dimension from the PR's file list with
 * the same {@link classifyReviewableFile} taxonomy the stats use, applying the
 * rubric the reviewer prompt already documents (test files relative to source
 * files: 50%+ excellent, 25–49% good, 1–24% fair, 0% poor). Scores interpolate
 * within each band so a borderline ratio does not jump between fixed numbers.
 * Every other dimension is left exactly as the AI assessed it.
 *
 * Applied both when a report is stored (`review-ingest.ts`, sync + async
 * paths) and when it is served (`GET /api/reviews/:id`), so legacy rows with
 * a miscounted score display correctly without a backfill. The function is
 * idempotent: re-applying it to an already-corrected score is a no-op.
 */

import { ratingForScore } from '@harness/domain';
import type { HealthRating } from '@harness/domain';

import { classifyReviewableFile } from './review-file-classify.js';

/** Score for a change carrying tests but no production source (ratio is infinite). */
const TESTS_ONLY_SCORE = 95;
/** Score for a change touching production source with zero test files. */
const NO_TESTS_SCORE = 15;

/**
 * Compute the `testing` dimension from reviewable file paths. Returns
 * `undefined` when the diff carries neither test nor source files (docs /
 * config-only change) — there is no test-coverage signal to judge, so callers
 * must keep the AI's original value.
 */
export function testingHealthForFiles(filePaths: readonly string[]): {
  readonly rating: HealthRating;
  readonly score: number;
} | null {
  let tests = 0;
  let sources = 0;
  for (const path of filePaths) {
    const category = classifyReviewableFile(path);
    if (category === 'test') {
      tests += 1;
    } else if (category === 'source') {
      sources += 1;
    }
  }
  if (tests === 0 && sources === 0) {
    return null;
  }
  let score: number;
  if (sources === 0) {
    score = TESTS_ONLY_SCORE;
  } else if (tests === 0) {
    score = NO_TESTS_SCORE;
  } else {
    const ratio = tests / sources;
    if (ratio >= 0.5) {
      // excellent 85–100: 0.5 → 85, ≥1.0 → 100.
      score = 85 + Math.round(15 * Math.min(1, (ratio - 0.5) / 0.5));
    } else if (ratio >= 0.25) {
      // good 70–84.
      score = 70 + Math.round(14 * ((ratio - 0.25) / 0.25));
    } else {
      // fair 50–69 (ratio > 0 here, since tests ≥ 1).
      score = 50 + Math.round(19 * (ratio / 0.25));
    }
  }
  return { rating: ratingForScore(score), score };
}

/**
 * Return `healthScore` with its `testing` / `testingScore` fields replaced by
 * the deterministic file-based assessment. Non-object values (`null` for
 * legacy reports without any score) and diffs without a test/source signal
 * pass through untouched.
 */
export function withDeterministicTestingScore<T>(healthScore: T, filePaths: readonly string[]): T {
  if (typeof healthScore !== 'object' || healthScore === null) {
    return healthScore;
  }
  const testing = testingHealthForFiles(filePaths);
  if (testing === null) {
    return healthScore;
  }
  return {
    ...(healthScore as Record<string, unknown>),
    testing: testing.rating,
    testingScore: testing.score,
  } as T;
}
