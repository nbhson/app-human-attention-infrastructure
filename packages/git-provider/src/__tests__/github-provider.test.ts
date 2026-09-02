import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitHubProvider, nextPagePath } from '../github-provider.js';
import type { GithubPullPayload, GithubPrFilePayload } from '../github-mapper.js';

/** A minimal `Response` stand-in carrying only what `GitHubProvider` reads. */
function jsonResponse(payload: unknown, opts: { link?: string | null; ok?: boolean; status?: number } = {}): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: 'OK',
    json: async () => payload,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'link' ? (opts.link ?? null) : null),
    },
  } as unknown as Response;
}

const meta: GithubPullPayload = {
  number: 482,
  title: 'Fix the retry loop',
  body: '',
  user: { login: 'acme-dev' },
  head: { ref: 'fix/retry', sha: 'headsha' },
  base: { ref: 'main', sha: 'basesha' },
  html_url: 'https://github.com/acme/api/pull/482',
};

function file(n: number): GithubPrFilePayload {
  return { filename: `src/f${n}.ts`, status: 'modified', additions: 1, deletions: 0, patch: null };
}

const API = 'https://api.github.com';

describe('nextPagePath', () => {
  it('returns null when the header is absent', () => {
    expect(nextPagePath(null)).toBeNull();
  });

  it('returns null when there is no rel="next" link', () => {
    expect(nextPagePath('<https://api.github.com/x?page=1&per_page=100>; rel="last"')).toBeNull();
  });

  it('reduces the rel="next" absolute URL to pathname + search', () => {
    const header =
      '<https://api.github.com/repos/acme/api/pulls/482/files?page=2&per_page=100>; rel="next", ' +
      '<https://api.github.com/repos/acme/api/pulls/482/files?per_page=100>; rel="first"';
    expect(nextPagePath(header)).toBe('/repos/acme/api/pulls/482/files?page=2&per_page=100');
  });
});

describe('fetchPullRequest files pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('follows the rel="next" chain past page 1 instead of truncating at the default per_page', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${API}/repos/acme/api/pulls/482`) {
        return jsonResponse(meta);
      }
      if (url === `${API}/repos/acme/api/pulls/482/files?per_page=100`) {
        return jsonResponse([file(1), file(2)], {
          link: `<${API}/repos/acme/api/pulls/482/files?page=2&per_page=100>; rel="next"`,
        });
      }
      if (url === `${API}/repos/acme/api/pulls/482/files?page=2&per_page=100`) {
        return jsonResponse([file(3)]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubProvider('token');
    const pr = await provider.fetchPullRequest({ repo: 'github.com/acme/api', number: 482 });

    expect(pr.files).toHaveLength(3);
    expect(pr.files.map((f) => f.path)).toEqual(['src/f1.ts', 'src/f2.ts', 'src/f3.ts']);
  });

  it('widens to the compare endpoint when the PR-files endpoint hits its 300-file cap', async () => {
    const capped = Array.from({ length: 300 }, (_, i) => file(i + 1));
    const compareFiles = [...capped, file(301)];

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${API}/repos/acme/api/pulls/482`) {
        return jsonResponse(meta);
      }
      if (url === `${API}/repos/acme/api/pulls/482/files?per_page=100`) {
        return jsonResponse(capped, {
          // The hard-capped endpoint reports the first 300 with no further page.
          link: null,
        });
      }
      if (url.startsWith(`${API}/repos/acme/api/compare/basesha...headsha`)) {
        return jsonResponse({ files: compareFiles });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubProvider('token');
    const pr = await provider.fetchPullRequest({ repo: 'github.com/acme/api', number: 482 });

    expect(pr.files).toHaveLength(301);
  });

  it('keeps the capped list when the compare endpoint fails', async () => {
    const capped = Array.from({ length: 300 }, (_, i) => file(i + 1));

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${API}/repos/acme/api/pulls/482`) {
        return jsonResponse(meta);
      }
      if (url === `${API}/repos/acme/api/pulls/482/files?per_page=100`) {
        return jsonResponse(capped);
      }
      if (url.startsWith(`${API}/repos/acme/api/compare/basesha...headsha`)) {
        return jsonResponse({}, { ok: false, status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubProvider('token');
    const pr = await provider.fetchPullRequest({ repo: 'github.com/acme/api', number: 482 });

    expect(pr.files).toHaveLength(300);
  });
});
