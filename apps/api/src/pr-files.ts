/**
 * PR-diff normalisation (trust-loop slice 2) — the stored `pr_payload` (a full
 * {@link PullRequest} snapshot held as jsonb) flattened into a stable per-file
 * diff shape the web client can render without trusting the JSON's raw shape.
 *
 * A pure, total reduction: any input (including the empty `{}` payload the
 * decision-route tests seed, a missing `files`, or malformed entries) yields an
 * array of well-typed {@link PrFile} rows, and never throws. Same family as
 * `computeReviewStats` / `computeFindingAnchor` — no clone, no new storage.
 */

/** One file's diff as surfaced to the web client. */
export interface PrFile {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch: string;
}

/** The stored `pr_payload.files` entry this normaliser reads. */
interface StoredPrFile {
  readonly path?: unknown;
  readonly status?: unknown;
  readonly additions?: unknown;
  readonly deletions?: unknown;
  readonly patch?: unknown;
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Flatten a stored pull-request payload into its per-file diff rows. */
export function normalizePrFiles(prPayload: unknown): PrFile[] {
  const payload = typeof prPayload === 'object' && prPayload !== null ? (prPayload as { files?: unknown }) : {};
  if (!Array.isArray(payload.files)) {
    return [];
  }

  const files: PrFile[] = [];
  for (const entry of payload.files as readonly StoredPrFile[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      continue;
    }
    files.push({
      path: entry.path,
      status: typeof entry.status === 'string' ? entry.status : 'unknown',
      additions: nonNegativeInt(entry.additions),
      deletions: nonNegativeInt(entry.deletions),
      patch: typeof entry.patch === 'string' ? entry.patch : '',
    });
  }
  return files;
}
