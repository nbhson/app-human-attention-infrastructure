/**
 * PR/MR URL parsing for the review-ingest slice: turn a pasted web URL into the
 * `host/owner/name` repo slug + PR number the {@link GitProvider} seam expects.
 */

import { ReviewIngestError } from './errors.js';

function canonicalHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Parse a GitHub / GitLab (cloud + self-hosted) / Bitbucket PR/MR web URL into
 * the `host/owner/name` repo slug + PR number the {@link GitProvider} seam
 * expects. Kept as `parseGithubPrUrl` for backwards compat — it now handles all
 * supported forges.
 */
export function parseGithubPrUrl(prUrl: string): { repo: string; number: number } {
  let url: URL;
  try {
    url = new URL(prUrl);
  } catch {
    throw new ReviewIngestError(`"${prUrl}" is not a valid URL`, 400);
  }
  const host = canonicalHost(url.host);
  const path = url.pathname;

  if (host === 'github.com') {
    const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(path);
    if (!m) throw new ReviewIngestError(`"${prUrl}" is not a GitHub pull-request URL`, 400);
    return { repo: `github.com/${m[1]}/${m[2]}`, number: Number(m[3]) };
  }

  if (host === 'gitlab.com') {
    const m = /^\/(.+)\/-\/merge_requests\/(\d+)\/?$/.exec(path);
    if (!m) throw new ReviewIngestError(`"${prUrl}" is not a GitLab merge-request URL`, 400);
    return { repo: `gitlab.com/${m[1]}`, number: Number(m[2]) };
  }

  if (host === 'bitbucket.org') {
    const m = /^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/?$/.exec(path);
    if (!m) throw new ReviewIngestError(`"${prUrl}" is not a Bitbucket pull-request URL`, 400);
    return { repo: `bitbucket.org/${m[1]}/${m[2]}`, number: Number(m[3]) };
  }

  // Bitbucket Server / Data Center (self-hosted, any host):
  // /projects/{project}/repos/{repo}/pull-requests/{id}[/{overview,diff,commits,...}]
  // (mirrors parsePrUrl in review-input-facade.ts — keep the two in sync).
  const bbServerM = /^\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)(?:\/.*)?$/.exec(path);
  if (bbServerM) {
    return { repo: `${host}/${bbServerM[1]}/${bbServerM[2]}`, number: Number(bbServerM[3]) };
  }

  // Self-hosted GitLab (e.g. gitlab.kidsplaza.org): any host whose path matches
  // the GitLab MR shape `/-/merge_requests/<iid>`.
  const gitlabM = /^\/(.+)\/-\/merge_requests\/(\d+)\/?$/.exec(path);
  if (gitlabM) {
    return { repo: `${host}/${gitlabM[1]}`, number: Number(gitlabM[2]) };
  }

  // Fallback: legacy GitHub shape for GHES (github.example.com)
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 4 && parts[2] === 'pull') {
    const number = Number(parts[3]);
    if (Number.isInteger(number)) return { repo: `${host}/${parts[0]}/${parts[1]}`, number };
  }

  throw new ReviewIngestError(
    `unsupported Git host "${host}" (expected github.com, gitlab.com, bitbucket.org, or a self-hosted GitLab / Bitbucket Server URL shape)`,
    400,
  );
}
