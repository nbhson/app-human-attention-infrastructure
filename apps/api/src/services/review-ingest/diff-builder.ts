/**
 * Diff assembly for the review-ingest slice: concatenate a PR's per-file
 * patches into the single diff block the LLM prompt consumes.
 */

import { isReviewableFile } from '../../review-file-classify.js';
import { redactReviewPatch } from '../../review-secret-redact.js';

import type { PullRequestFile } from '@harness/domain';

/**
 * Concatenate a PR's per-file patches into one diff block. Every hand-written
 * file is kept — source, docs (README), config and infra (Dockerfile, YAML,
 * JSON, env, …) alike; only generated artifacts ({@link isGeneratedFile}) and
 * empty/binary patches are dropped (see {@link isReviewableFile}). Secret values
 * on `.env` / Compose files are masked (see {@link redactSensitivePatch}) so a
 * live credential never reaches the LLM prompt. The AI reviews the *whole*
 * change, not just the code.
 */
export function buildDiff(files: readonly PullRequestFile[]): string {
  return files
    .filter((f) => isReviewableFile(f.path) && f.patch.trim().length > 0)
    .map(
      (f) => `=== ${f.path} (${f.status}, +${f.additions} -${f.deletions}) ===\n` + redactReviewPatch(f.path, f.patch),
    )
    .join('\n\n');
}
