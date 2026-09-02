/**
 * Head-SHA resolution (Phase 3 day-11 §3.2).
 *
 * The three Git hosts each surface the PR head commit under a different key in
 * their native payloads — GitHub `head.sha`, GitLab the MR `sha`, Bitbucket
 * `source.commit.hash` — but every mapper already normalises it into
 * {@link PullRequest.head.sha}. `resolveHeadSha` is therefore host-agnostic: it
 * extracts that field and validates it is a usable commit SHA, so a malformed or
 * missing head never flows silently into a checkout (the "test the wrong commit"
 * trap, day-11 §6). `cloneInputFromPullRequest` is the one-call convenience that
 * turns a fetched PR into the resolved {@link CloneInput} a clone needs.
 */

import type { CloneInput } from './git-provider.js';
import { GitProviderError } from './git-provider.js';
import type { PullRequest } from '@harness/domain';

/** Full or short commit SHA (7–64 hex). `head.sha` from a forge is typically 40. */
const SHA_RE = /^[0-9a-f]{7,64}$/i;

/**
 * Return the PR's head commit SHA, or throw {@link GitProviderError} when the
 * pulled `head.sha` is absent, empty, or not a plausible SHA.
 */
export function resolveHeadSha(pullRequest: PullRequest): string {
  const sha = pullRequest.head.sha.trim();
  if (!SHA_RE.test(sha)) {
    throw new GitProviderError(`pull request #${pullRequest.number} head SHA is not usable: "${pullRequest.head.sha}"`);
  }
  return sha;
}

/**
 * Build a resolved {@link CloneInput} from a fetched {@link PullRequest}. The
 * head SHA is validated via {@link resolveHeadSha}; branches come straight from
 * the PR's `head`/`base` refs. This is the bridge between "fetched a PR" and
 * "clone + check out its merge candidate".
 */
export function cloneInputFromPullRequest(pullRequest: PullRequest): CloneInput {
  return {
    repo: pullRequest.repo,
    number: pullRequest.number,
    headSha: resolveHeadSha(pullRequest),
    sourceBranch: pullRequest.head.ref,
    targetBranch: pullRequest.base.ref,
  };
}
