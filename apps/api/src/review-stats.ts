/**
 * Review report statistics (review-reorient Phase 3).
 *
 * The product's whole thesis is "route human attention to only what matters", so
 * the report surface owes the reviewer a one-glance answer to two questions:
 *
 *  - Of the PR's changed lines, how many actually carry a finding (→ how much of
 *    this diff needs a human to look at it)?
 *  - Split the findings across the severity bands (→ how much of the review is
 *    CRITICAL vs MINOR vs …)?
 *
 * Both are derivable from data already persisted: `review_reports.pr_payload`
 * holds the full {@link PullRequest} snapshot (per-file `additions`/`deletions`),
 * and `review_findings` holds each finding's `file` + `line`. Nothing new is
 * stored or fetched — this module is a pure reduction over what the `GET
 * /api/reviews/:id` route already has in hand.
 */

import { ReviewSeverity } from '@harness/domain';
import type { ReviewSeverity as ReviewSeverityType } from '@harness/domain';

/** Severity bands, highest first — the same order the AI reports them in. */
export const SEVERITY_ORDER = [
  ReviewSeverity.Critical,
  ReviewSeverity.Major,
  ReviewSeverity.Minor,
  ReviewSeverity.Nit,
  ReviewSeverity.Info,
] as const;

/** A severity-band count keyed by band name. */
export type SeverityCounts = Record<ReviewSeverityType, number>;

/** The derived, denormalised statistics block surfaced on the report. */
export interface ReviewStats {
  /** Files in the PR diff (from the stored `pr_payload`). */
  readonly totalFiles: number;
  /** Lines added across all files. */
  readonly addedLines: number;
  /** Lines removed across all files. */
  readonly removedLines: number;
  /** `addedLines + removedLines` — the PR's diff size. */
  readonly changedLines: number;
  /** Distinct `file:line` anchors a finding points at (line-level findings only). */
  readonly flaggedLines: number;
  /** Distinct files that carry at least one finding. */
  readonly flaggedFiles: number;
  /** `flaggedLines / changedLines`, clamped to [0, 1] (0 when the PR is empty). */
  readonly attentionShare: number;
  /** Total number of findings (the denominator for the severity split). */
  readonly findingTotal: number;
  /** Findings counted per severity band, every band present (0 when empty). */
  readonly severity: SeverityCounts;
}

/** The subset of a finding the stats need — DB row(s) or API-mapped row(s) alike. */
export interface FindingRef {
  readonly severity: string;
  readonly file: string;
  readonly line: number | null;
}

/** The subset of the stored `pr_payload` the stats read (see `PullRequestFile`). */
interface StoredPrPayload {
  readonly files?: readonly {
    readonly additions?: number;
    readonly deletions?: number;
  }[];
}

function toNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Clamp a ratio to [0, 1] and round to 4 decimal places (percent to 2 dp). */
function share(flagged: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  const ratio = Math.min(1, Math.max(0, flagged / total));
  return Math.round(ratio * 10_000) / 10_000;
}

/**
 * Reduce the stored pull-request payload + the report's findings into a
 * {@link ReviewStats}. Purely functional; safe against the empty `{}` payload the
 * decision-route tests seed and against findings whose `line` is null.
 */
export function computeReviewStats(
  prPayload: unknown,
  findings: readonly FindingRef[],
): ReviewStats {
  const payload =
    typeof prPayload === 'object' && prPayload !== null ? (prPayload as StoredPrPayload) : {};
  const files = Array.isArray(payload.files) ? payload.files : [];

  const addedLines = files.reduce((sum, file) => sum + toNonNegative(file?.additions), 0);
  const removedLines = files.reduce((sum, file) => sum + toNonNegative(file?.deletions), 0);
  const changedLines = addedLines + removedLines;

  const flaggedAnchors = new Set<string>();
  const flaggedFiles = new Set<string>();
  for (const finding of findings) {
    if (typeof finding.file === 'string' && finding.file.length > 0) {
      flaggedFiles.add(finding.file);
      if (finding.line !== null && finding.line !== undefined) {
        flaggedAnchors.add(`${finding.file}:${finding.line}`);
      }
    }
  }

  const severity = Object.fromEntries(SEVERITY_ORDER.map((band) => [band, 0])) as SeverityCounts;
  for (const finding of findings) {
    if ((SEVERITY_ORDER as readonly string[]).includes(finding.severity)) {
      severity[finding.severity as ReviewSeverityType] += 1;
    }
  }

  return {
    totalFiles: files.length,
    addedLines,
    removedLines,
    changedLines,
    flaggedLines: flaggedAnchors.size,
    flaggedFiles: flaggedFiles.size,
    attentionShare: share(flaggedAnchors.size, changedLines),
    findingTotal: findings.length,
    severity,
  };
}
