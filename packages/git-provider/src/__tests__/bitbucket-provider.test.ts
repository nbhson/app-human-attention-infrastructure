import { describe, expect, it, vi, afterEach } from 'vitest';

import { BitbucketDirectProvider, patchHasCodeLines } from '../bitbucket-provider.js';

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function textResponse(text: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'text/plain' },
    json: async () => {
      throw new Error('not json');
    },
    text: async () => text,
  } as unknown as Response;
}

const CLOUD_META = {
  id: 3,
  title: 'Add widget',
  description: 'desc',
  author: { display_name: 'alice', nickname: 'alice' },
  source: { branch: { name: 'feature' }, commit: { hash: 'abc123' } },
  destination: { branch: { name: 'main' }, commit: { hash: 'def456' } },
  links: { html: { href: 'https://bitbucket.org/acme/widget/pull-requests/3' } },
};

const CLOUD_DIFFSTAT = {
  values: [
    { status: 'modified', lines_added: 5, lines_removed: 1, new: { path: 'src/a.ts' }, old: { path: 'src/a.ts' } },
  ],
};

const CLOUD_DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,6 @@
 context
-old line
+new line 1
+new line 2
`;

describe('patchHasCodeLines', () => {
  it('rejects empty and hunk-headers-only patches', () => {
    expect(patchHasCodeLines('')).toBe(false);
    expect(patchHasCodeLines('@@ -1,3 +1,3 @@')).toBe(false);
    expect(patchHasCodeLines('diff --git a/x b/x\n--- a/x\n+++ b/x')).toBe(false);
  });
  it('accepts real +/- lines', () => {
    expect(patchHasCodeLines('@@ -1 +1 @@\n-old\n+new')).toBe(true);
  });
});

describe('BitbucketDirectProvider (Cloud)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches Cloud PR with diff + diffstat content', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/pullrequests/3')) return jsonResponse(CLOUD_META);
      if (url.includes('/diffstat')) return jsonResponse(CLOUD_DIFFSTAT);
      if (url.endsWith('/diff')) return textResponse(CLOUD_DIFF);
      if (url.includes('/commits')) return jsonResponse({ values: [] });
      throw new Error(`unexpected ${url}`);
    });
    const provider = new BitbucketDirectProvider({ token: 't', fetchFn: fetchMock as unknown as typeof fetch });
    const pr = await provider.fetchPullRequest({ repo: 'bitbucket.org/acme/widget', number: 3 });
    expect(pr.title).toBe('Add widget');
    expect(pr.files).toHaveLength(1);
    expect(pr.files[0]!.path).toBe('src/a.ts');
    expect(patchHasCodeLines(pr.files[0]!.patch)).toBe(true);
    expect(pr.files[0]!.additions).toBe(5);
  });

  it('throws a clear error when diff + diffstat are both empty', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/pullrequests/3')) return jsonResponse(CLOUD_META);
      if (url.includes('/diffstat')) return jsonResponse({ values: [] });
      if (url.endsWith('/diff')) return textResponse('');
      if (url.includes('/commits')) return jsonResponse({ values: [] });
      throw new Error(`unexpected ${url}`);
    });
    const provider = new BitbucketDirectProvider({ token: 't', fetchFn: fetchMock as unknown as typeof fetch });
    await expect(provider.fetchPullRequest({ repo: 'bitbucket.org/acme/widget', number: 3 })).rejects.toThrow(
      /no files resolved/,
    );
  });

  it('sends Bearer auth header', async () => {
    let seenAuth = '';
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      seenAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      const url = String(input);
      if (url.endsWith('/pullrequests/3')) return jsonResponse(CLOUD_META);
      if (url.includes('/diffstat')) return jsonResponse(CLOUD_DIFFSTAT);
      if (url.endsWith('/diff')) return textResponse(CLOUD_DIFF);
      return jsonResponse({ values: [] });
    });
    const provider = new BitbucketDirectProvider({ token: 'tok123', fetchFn: fetchMock as unknown as typeof fetch });
    await provider.fetchPullRequest({ repo: 'bitbucket.org/acme/widget', number: 3 });
    expect(seenAuth).toBe('Bearer tok123');
  });

  it('sends Basic auth when username+password are set', async () => {
    let seenAuth = '';
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      seenAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      const url = String(input);
      if (url.endsWith('/pullrequests/3')) return jsonResponse(CLOUD_META);
      if (url.includes('/diffstat')) return jsonResponse(CLOUD_DIFFSTAT);
      if (url.endsWith('/diff')) return textResponse(CLOUD_DIFF);
      return jsonResponse({ values: [] });
    });
    const provider = new BitbucketDirectProvider({
      username: 'u',
      password: 'p',
      fetchFn: fetchMock as unknown as typeof fetch,
    });
    await provider.fetchPullRequest({ repo: 'bitbucket.org/acme/widget', number: 3 });
    expect(seenAuth.startsWith('Basic ')).toBe(true);
  });
});

describe('BitbucketDirectProvider (Server)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reconstructs patches from Server {diffs+hunks}', async () => {
    const serverMeta = {
      id: 7,
      title: 'Fix thing',
      description: '',
      author: { user: { displayName: 'bob' } },
      fromRef: { displayId: 'feature', latestCommit: 'sha1' },
      toRef: { displayId: 'main', latestCommit: 'sha0' },
      links: { self: [{ href: 'https://git.company.com/projects/P/repos/R/pull-requests/7' }] },
    };
    const serverDiff = {
      diffs: [
        {
          source: { toString: 'src/b.ts' },
          destination: { toString: 'src/b.ts' },
          hunks: [
            {
              sourceLine: 1,
              sourceSpan: 1,
              destinationLine: 1,
              destinationSpan: 2,
              segments: [
                { type: 'REMOVED', lines: ['old'] },
                { type: 'ADDED', lines: ['new1', 'new2'] },
              ],
            },
          ],
        },
      ],
    };
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/pull-requests/7')) return jsonResponse(serverMeta);
      if (url.includes('/diff')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify(serverDiff),
          json: async () => serverDiff,
        } as unknown as Response;
      }
      if (url.includes('/changes')) return jsonResponse({ values: [], isLastPage: true });
      if (url.includes('/commits')) return jsonResponse({ values: [], isLastPage: true });
      throw new Error(`unexpected ${url}`);
    });
    const provider = new BitbucketDirectProvider({
      token: 't',
      serverBaseUrl: 'https://git.company.com',
      fetchFn: fetchMock as unknown as typeof fetch,
    });
    const pr = await provider.fetchPullRequest({ repo: 'git.company.com/P/R', number: 7 });
    expect(pr.files).toHaveLength(1);
    expect(patchHasCodeLines(pr.files[0]!.patch)).toBe(true);
    expect(pr.files[0]!.additions).toBe(2);
    expect(pr.files[0]!.deletions).toBe(1);
  });
});
