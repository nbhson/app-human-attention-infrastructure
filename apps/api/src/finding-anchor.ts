/**
 * Finding-anchor verification (trust-loop) — the deterministic check that turns
 * "the AI said line N" into "the AI's line N actually points into this PR's diff".
 *
 * A reviewer cannot trust an LLM that hallucinates findings, so every finding is
 * cross-checked against the stored `pr_payload` (the full `PullRequest` snapshot
 * the review was produced from). The result is a per-finding `verified` /
 * `unverified` verdict plus a one-line human reason, surfaced on every finding
 * card. This is the first, cheap slice of the trust-loop: it needs no clone, no
 * sandbox, no new storage — a pure reduction over what `GET /api/reviews/:id`
 * already has in hand (same family as `computeReviewStats`).
 *
 * Semantics (documented, not guessed): a finding is `verified` when its
 * `file:line` resolves into the *new-file* line range of at least one change
 * hunk in that file's unified diff. `line` is 1-based (git's `+c,d` numbering),
 * matching how the AI is asked to report it in `buildDiff`. Lines inside a
 * hunk's context rows still count as "in the changed region"; a pure-deletion
 * hunk (`+c,0`) contributes no range and can anchor nothing.
 */

/** Trust-loop anchor status. */
export type AnchorStatus = 'verified' | 'unverified';

/** The per-finding anchor verdict + a short human-readable reason. */
export interface FindingAnchor {
  readonly status: AnchorStatus;
  readonly detail: string;
}

/** The subset of a stored `pr_payload` file this check reads. */
interface StoredPrFile {
  readonly path?: unknown;
  readonly patch?: unknown;
}

/** The subset of the stored `pr_payload` this check reads. */
interface StoredPrPayload {
  readonly files?: readonly StoredPrFile[] | null;
}

/**
 * Extract the 1-based *new-file* line ranges `[start, start + count)` from a
 * unified diff `patch`. Each `@@ -a,b +c,d @@` header yields one range; a
 * pure-deletion header (`c,0`) is skipped because it spans no new-file lines.
 * Missing/garbled headers are ignored — a patch with no parseable hunk can
 * verify nothing.
 */
function newFileHunkRanges(patch: string): ReadonlyArray<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  const header = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@(?:\s.*)?/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(patch)) !== null) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0 && Number.isInteger(start) && start >= 1) {
      ranges.push([start, start + count]);
    }
  }
  return ranges;
}

/** True when a 1-based line number falls inside any of the hunk ranges. */
function lineInRanges(line: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([start, end]) => line >= start && line < end);
}

/**
 * Verdict a finding's `file:line` anchor against the stored PR payload. Pure and
 * total: every input (including an empty `{}` payload and a null line) returns a
 * valid {@link FindingAnchor}, never throws.
 */
export function computeFindingAnchor(
  prPayload: unknown,
  file: string,
  line: number | null,
): FindingAnchor {
  if (typeof file !== 'string' || file.length === 0) {
    return { status: 'unverified', detail: 'no file anchor' };
  }
  if (line === null || line === undefined || !Number.isInteger(line) || line <= 0) {
    return { status: 'unverified', detail: 'finding has no line anchor' };
  }

  const payload =
    typeof prPayload === 'object' && prPayload !== null ? (prPayload as StoredPrPayload) : {};
  const files = Array.isArray(payload.files) ? payload.files : [];

  const matched = files.find((entry) => entry && entry.path === file);
  if (!matched) {
    return { status: 'unverified', detail: 'file not touched by this PR' };
  }
  if (typeof matched.patch !== 'string' || matched.patch.length === 0) {
    return { status: 'unverified', detail: 'file has no diff hunks to anchor against' };
  }

  const ranges = newFileHunkRanges(matched.patch);
  if (ranges.length === 0) {
    return { status: 'unverified', detail: 'no parseable hunks in this file diff' };
  }
  if (!lineInRanges(line, ranges)) {
    return { status: 'unverified', detail: `line ${line} not in the changed region` };
  }
  return { status: 'verified', detail: `line ${line} is in this diff` };
}
