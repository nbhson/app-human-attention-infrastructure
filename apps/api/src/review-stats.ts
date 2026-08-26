/**
 * Review report statistics (review-reorient Phase 3).
 *
 * The product's whole thesis is "route human attention to only what matters", so
 * the report surface owes the reviewer a one-glance answer to two questions:
 *
 *  - What share of the PR's *source files* carry an actionable finding
 *    (CRITICAL/MAJOR/MINOR — nitpicks/praise don't count, and a
 *    lockfile/README/Dockerfile rewrite isn't source)? That is the product's
 *    one-glance "how much of this change needs a human" answer, and it is
 *    directly provable: every flagged file is named in a finding.
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

import { classifySourceFile, isGeneratedFile, isSourceFile } from './review-file-classify.js';
import type { SourceCategory } from './review-file-classify.js';

/** Severity bands, highest first — the same order the AI reports them in. */
export const SEVERITY_ORDER = [
  ReviewSeverity.Critical,
  ReviewSeverity.Major,
  ReviewSeverity.Minor,
  ReviewSeverity.Nit,
  ReviewSeverity.Info,
] as const;

/**
 * Severities that demand a human action. NIT and INFO are excluded: they flag
 * nitpicks and praise (an INFO finding on a thorough README is a compliment,
 * not a call for attention), and counting them is what inflated the attention
 * hero to 100% on a one-line NIT, or 46% on a README whose only finding is a
 * compliment.
 */
const ACTIONABLE_SEVERITIES = new Set<string>([
  ReviewSeverity.Critical,
  ReviewSeverity.Major,
  ReviewSeverity.Minor,
]);

/** A severity-band count keyed by band name. */
export type SeverityCounts = Record<ReviewSeverityType, number>;

/** The derived, denormalised statistics block surfaced on the report. */
export interface ReviewStats {
  /** Source/logic files in the diff (generated, doc, config and infra excluded). */
  readonly totalFiles: number;
  /** Lines added across source files. */
  readonly addedLines: number;
  /** Lines removed across source files. */
  readonly removedLines: number;
  /** `addedLines + removedLines` — the source diff's size. */
  readonly changedLines: number;
  /** Added source lines living in files that carry at least one actionable finding. */
  readonly flaggedAddedLines: number;
  /** Distinct source files that carry an actionable finding (NIT/INFO excluded). */
  readonly flaggedFiles: number;
  /** The source diff split by what the added lines are (test/style/markup/source). */
  readonly composition: readonly {
    readonly category: SourceCategory;
    readonly files: number;
    readonly additions: number;
    readonly deletions: number;
  }[];
  /** Diff lines rejected as non-source (generated/doc/config/infra) — out of the metric. */
  readonly excluded: {
    readonly files: number;
    readonly additions: number;
    readonly deletions: number;
    /** The rejected files, named — the proof of what the denominator leaves out. */
    readonly filesList: readonly {
      readonly path: string;
      readonly additions: number;
      readonly deletions: number;
      /** `generated` = lockfile/build artefact; `non-source` = docs/config/infra. */
      readonly reason: 'generated' | 'non-source';
    }[];
  };
  /** Source files carrying an actionable finding — the proof of `attentionShare`. */
  readonly flaggedFilesList: readonly {
    readonly file: string;
    readonly severities: readonly string[];
  }[];
  /**
   * Cleanup opportunities (dead code / duplication / naming), a parallel signal
   * to `attentionShare`: counted at every severity (a NIT "unused function" is
   * still a removal candidate the reviewer may want to see) but never moved the
   * attention percentage — that stays a function of actionable severity alone.
   */
  readonly cleanup: {
    /** Distinct source files carrying at least one `cleanup` finding. */
    readonly files: number;
    /** Total `cleanup` findings across those files. */
    readonly findings: number;
    /** The proof: each cleanup-carrying file, with its cleanup-finding count. */
    readonly filesList: readonly { readonly file: string; readonly count: number }[];
  };
  /**
   * `flaggedFiles / totalFiles`, clamped to [0, 1] (0 when no source files).
   * File-based, not line-based, so the hero is provable at a glance: "3 of 12
   * files" maps one-to-one onto the findings listed below (a 600-line file with
   * one finding is *one* file, not 600 lines of unclear "attention").
   */
  readonly attentionShare: number;
  /** Total number of findings (the denominator for the severity split). */
  readonly findingTotal: number;
  /** Findings counted per severity band, every band present (0 when empty). */
  readonly severity: SeverityCounts;
}

/** The subset of a finding the stats need — DB row(s) or API-mapped row(s) alike. */
export interface FindingRef {
  readonly severity: string;
  /** Finding kind — `cleanup` marks dead code / duplication / naming. */
  readonly kind?: string;
  readonly file: string;
  readonly line: number | null;
}

/** The subset of the stored `pr_payload` the stats read (see `PullRequestFile`). */
interface StoredPrPayload {
  readonly files?: readonly {
    readonly path?: string;
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
  const allFiles = Array.isArray(payload.files) ? payload.files : [];
  // The attention block is about *code*, not the whole diff. A lockfile that
  // adds 9k lines, a README rewrite, or a Dockerfile/nginx tweak must not move
  // "needs human attention" — the metric is meant to answer "how much of the
  // SOURCE you wrote needs a human to look at it". So the diff-derived numbers
  // count only hand-written source files; `findingTotal` + `severity` still span
  // every finding (a CRITICAL on a deleted file still shows in the severity bar).
  const files = allFiles.filter((file) => isSourceFile(file?.path ?? ''));

  const addedLines = files.reduce((sum, file) => sum + toNonNegative(file?.additions), 0);
  const removedLines = files.reduce((sum, file) => sum + toNonNegative(file?.deletions), 0);
  const changedLines = addedLines + removedLines;

  // The attention share is counted per *file*, not per line: a finding about a
  // file means "review this file", and "3 of 12 source files" is something the
  // reviewer can prove by counting the `file`s on the findings below. Counting
  // added *lines* is what produced the absurd numbers this pivot walks away
  // from — one finding in a 600-line `toeic.service.ts` inflating the hero to
  // 25%, or a README rewrite (not even source) to "44%". NIT and INFO are
  // deliberately excluded: they are nitpicks / praise, not calls for attention.
  // Group actionable findings per source file so `attentionShare` is provable:
  // `flaggedFiles.size` is the numerator, and `flaggedFilesList` names each file
  // with its severities (the proof). The Map also feeds `flaggedAddedLines`.
  const flaggedFiles = new Map<string, string[]>();
  for (const finding of findings) {
    if (
      typeof finding.file === 'string' &&
      finding.file.length > 0 &&
      isSourceFile(finding.file) &&
      ACTIONABLE_SEVERITIES.has(finding.severity)
    ) {
      const existing = flaggedFiles.get(finding.file);
      if (existing) {
        existing.push(finding.severity);
      } else {
        flaggedFiles.set(finding.file, [finding.severity]);
      }
    }
  }
  const flaggedAddedLines = files.reduce((sum, file) => {
    const path = file?.path;
    return typeof path === 'string' && flaggedFiles.has(path)
      ? sum + toNonNegative(file?.additions)
      : sum;
  }, 0);

  // The source diff, split by what the added lines actually are (test specs /
  // styles / markup / the remaining source) so "2395 added lines" is not read as
  // "2395 lines of dense logic". Only source files are in this breakdown.
  const COMPOSITION_ORDER = [
    'test',
    'style',
    'markup',
    'source',
  ] as const satisfies readonly SourceCategory[];
  const composition = COMPOSITION_ORDER.map((category) => {
    const inCategory = files.filter((file) => classifySourceFile(file?.path ?? '') === category);
    return {
      category,
      files: inCategory.length,
      additions: inCategory.reduce((sum, file) => sum + toNonNegative(file?.additions), 0),
      deletions: inCategory.reduce((sum, file) => sum + toNonNegative(file?.deletions), 0),
    };
  }).filter((row) => row.files > 0);

  // The part of the diff we deliberately throw away: lockfiles, docs, config and
  // infra. Surfacing it — by name, not just count — shows the attention
  // denominator is small *for a reason*: it is verifiable that "9,140 excluded
  // lines" means "package-lock.json", not hidden logic. `generated` (lockfile /
  // build artefact) is split from `non-source` (docs/config/infra) so the reader
  // sees which are which instead of one undifferentiated blob.
  const allAdded = allFiles.reduce((sum, file) => sum + toNonNegative(file?.additions), 0);
  const allRemoved = allFiles.reduce((sum, file) => sum + toNonNegative(file?.deletions), 0);
  const excludedFiles = allFiles.filter((file) => !isSourceFile(file?.path ?? ''));
  const excluded: ReviewStats['excluded'] = {
    files: excludedFiles.length,
    additions: allAdded - addedLines,
    deletions: allRemoved - removedLines,
    filesList: excludedFiles
      .map((file) => {
        const path = file?.path ?? '';
        return {
          path,
          additions: toNonNegative(file?.additions),
          deletions: toNonNegative(file?.deletions),
          reason: (isGeneratedFile(path) ? 'generated' : 'non-source') as
            'generated' | 'non-source',
        };
      })
      .sort((a, b) => {
        // Generated first (most obviously out of scope), then largest lines first.
        if (a.reason !== b.reason) return a.reason === 'generated' ? -1 : 1;
        return b.additions - a.additions || a.path.localeCompare(b.path);
      }),
  };

  const flaggedFilesList: ReviewStats['flaggedFilesList'] = [...flaggedFiles.entries()]
    .map(([file, severities]) => ({ file, severities: [...severities] }))
    .sort((a, b) => {
      const worst = (severities: readonly string[]): number =>
        Math.min(
          ...severities.map((severity) => (SEVERITY_ORDER as readonly string[]).indexOf(severity)),
        );
      return worst(a.severities) - worst(b.severities) || a.file.localeCompare(b.file);
    });

  // Cleanup opportunities (dead code / duplication / naming): tally `cleanup`-kind
  // findings per source file. This selects on the *kind* axis, orthogonal to the
  // `flaggedFiles` severity selection above, so a NIT "unused function" surfaces
  // here as a removal candidate without inflating `flaggedFiles`/`attentionShare`.
  const cleanupTally = new Map<string, number>();
  for (const finding of findings) {
    if (
      finding.kind === 'cleanup' &&
      typeof finding.file === 'string' &&
      isSourceFile(finding.file)
    ) {
      cleanupTally.set(finding.file, (cleanupTally.get(finding.file) ?? 0) + 1);
    }
  }
  const cleanupFilesList = [...cleanupTally.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

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
    flaggedAddedLines,
    flaggedFiles: flaggedFiles.size,
    attentionShare: share(flaggedFiles.size, files.length),
    findingTotal: findings.length,
    severity,
    composition,
    excluded,
    flaggedFilesList,
    cleanup: {
      files: cleanupTally.size,
      findings: [...cleanupTally.values()].reduce((sum, count) => sum + count, 0),
      filesList: cleanupFilesList,
    },
  };
}
