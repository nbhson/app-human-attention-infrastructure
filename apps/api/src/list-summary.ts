/**
 * Review-queue list denormalisation (landing-page rebuild) — reduce the stored
 * `pr_payload` and a report's findings into the extra fields the queue cards need
 * (author, branch, diff totals, a derived risk score + priority) without any new
 * storage. Pure, total, never-throws, same family as `pr-files.ts` /
 * `review-stats.ts`: any input — including the empty `{}` payload the decision-route
 * tests seed — yields a well-typed result.
 */

import { nonNegativeInt } from './env-utils.js';

/** The subset of `pr_payload` this module reads (see the `PullRequest` domain type). */
interface StoredPrFile {
  readonly path?: unknown;
  readonly additions?: unknown;
  readonly deletions?: unknown;
}

interface StoredPrPayload {
  readonly author?: unknown;
  readonly sourceBranch?: unknown;
  readonly targetBranch?: unknown;
  readonly files?: readonly StoredPrFile[];
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The queue-card metadata derivable from the stored payload alone. */
export interface ListPayloadSummary {
  readonly author: string | null;
  readonly sourceBranch: string | null;
  readonly targetBranch: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly filesChanged: number;
}

/** Flatten a stored pull-request payload into the queue-card summary fields. */
export function summaryFromPayload(prPayload: unknown): ListPayloadSummary {
  const payload =
    typeof prPayload === 'object' && prPayload !== null ? (prPayload as StoredPrPayload) : {};
  const files = Array.isArray(payload.files) ? payload.files : [];
  const additions = files.reduce((sum, file) => sum + nonNegativeInt(file?.additions), 0);
  const deletions = files.reduce((sum, file) => sum + nonNegativeInt(file?.deletions), 0);
  return {
    author: toNullableString(payload.author),
    sourceBranch: toNullableString(payload.sourceBranch),
    targetBranch: toNullableString(payload.targetBranch),
    additions,
    deletions,
    filesChanged: files.length,
  };
}

/** The PR's touched file paths, or `[]` — used by the triage schema/metadata rules. */
export function prFilePathsFromPayload(prPayload: unknown): string[] {
  const payload =
    typeof prPayload === 'object' && prPayload !== null ? (prPayload as StoredPrPayload) : {};
  const files = Array.isArray(payload.files) ? payload.files : [];
  return files
    .map((file) => toNullableString(file?.path))
    .filter((path): path is string => path !== null);
}

/**
 * Severity → fixed weight, summed and clamped to [0, 100]. A deterministic,
 * documented "risk" heuristic: one CRITICAL (35) reads as high; a lone MAJOR
 * (15) is medium; a couple of MINORs (6 each) or less is low. INFO contributes
 * nothing. This is the single source of the queue's `riskScore` + `priority`.
 */
const RISK_WEIGHTS: Record<string, number> = {
  CRITICAL: 35,
  MAJOR: 15,
  MINOR: 6,
  NIT: 2,
  INFO: 0,
};

/** Total a report's findings into a 0-100 risk score. */
export function riskScoreFromSeverities(severities: readonly string[]): number {
  const total = severities.reduce((sum, severity) => sum + (RISK_WEIGHTS[severity] ?? 0), 0);
  return Math.min(100, Math.max(0, total));
}

/** The queue's priority axis, derived from the risk score. */
export type PriorityLevel = 'high' | 'medium' | 'low';

/** Map a 0-100 risk score onto the queue's high/medium/low priority tiers. */
export function priorityFromRiskScore(score: number): PriorityLevel {
  if (score >= 30) {
    return 'high';
  }
  if (score >= 10) {
    return 'medium';
  }
  return 'low';
}
