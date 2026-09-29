import { describe, expect, it } from 'vitest';

import type { PullRequest } from '@harness/domain';

import { BitbucketDirectProvider } from '../bitbucket-provider.js';
import { HybridGitProvider, hasUsableFileContent } from '../hybrid-git-provider.js';
import { StaticGitToolMap } from '../git-tool-map.js';
import type { FetchPullRequestInput, GitProvider } from '../git-provider.js';

function prWithPatch(patch: string): PullRequest {
  return {
    provider: 'bitbucket' as const,
    number: 1,
    title: 't',
    description: '',
    author: 'a',
    sourceBranch: 'f',
    targetBranch: 'm',
    base: { ref: 'm', sha: '', repo: 'bitbucket.org/a/b' },
    head: { ref: 'f', sha: '', repo: 'bitbucket.org/a/b' },
    url: 'https://bitbucket.org/a/b/pull-requests/1',
    repo: 'bitbucket.org/a/b',
    files: [{ path: 'src/a.ts', status: 'MODIFIED' as const, additions: 1, deletions: 0, patch }],
  };
}

class StubPrimary implements GitProvider {
  constructor(private readonly pr: PullRequest | null, private readonly err?: Error) {}
  async fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest> {
    void input;
    if (this.err) throw this.err;
    return this.pr!;
  }
  async postComment(): Promise<void> {}
  async setStatus(): Promise<void> {}
  async cloneAndCheckout(): Promise<never> {
    throw new Error('not used');
  }
}

class StubDirect extends BitbucketDirectProvider {
  constructor(private readonly pr: PullRequest) {
    super({ token: 't' });
  }
  override async fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest> {
    void input;
    return this.pr;
  }
}

describe('hasUsableFileContent', () => {
  it('false for empty / hunk-only patches', () => {
    expect(hasUsableFileContent(prWithPatch(''))).toBe(false);
    expect(hasUsableFileContent(prWithPatch('@@ -1,3 +1,3 @@'))).toBe(false);
  });
  it('true for real code lines', () => {
    expect(hasUsableFileContent(prWithPatch('@@ -1 +1 @@\n-old\n+new'))).toBe(true);
  });
});

describe('HybridGitProvider', () => {
  const toolMap = new StaticGitToolMap();

  it('returns MCP result when it has usable content (no fallback)', async () => {
    const good = prWithPatch('@@ -1 +1 @@\n-old\n+new');
    let fallback = 0;
    const hybrid = new HybridGitProvider(new StubPrimary(good), new StubDirect(good), toolMap, {
      onFallback: () => {
        fallback += 1;
      },
    });
    const out = await hybrid.fetchPullRequest({ repo: 'bitbucket.org/a/b', number: 1 });
    expect(out.files[0]!.patch).toContain('+new');
    expect(fallback).toBe(0);
  });

  it('falls back to direct when MCP has hunk-only content', async () => {
    const bad = prWithPatch('@@ -1,3 +1,3 @@');
    const good = prWithPatch('@@ -1 +1 @@\n-old\n+new');
    let reason = '';
    const hybrid = new HybridGitProvider(new StubPrimary(bad), new StubDirect(good), toolMap, {
      onFallback: (info) => {
        reason = info.reason;
      },
    });
    const out = await hybrid.fetchPullRequest({ repo: 'bitbucket.org/a/b', number: 1 });
    expect(out.files[0]!.patch).toContain('+new');
    expect(reason).toMatch(/code lines|MCP/);
  });

  it('falls back to direct when MCP throws', async () => {
    const good = prWithPatch('@@ -1 +1 @@\n-old\n+new');
    const hybrid = new HybridGitProvider(
      new StubPrimary(null, new Error('mcp tool failed')),
      new StubDirect(good),
      toolMap,
    );
    const out = await hybrid.fetchPullRequest({ repo: 'bitbucket.org/a/b', number: 1 });
    expect(out.files[0]!.patch).toContain('+new');
  });

  it('routes a self-hosted Bitbucket Server domain via the toolMap', async () => {
    const bad = prWithPatch('@@ -1,3 +1,3 @@');
    const good = prWithPatch('@@ -1 +1 @@\n-old\n+new');
    // Minimal map: only knows the self-hosted domain -> bitbucket row.
    const map = {
      resolveHost: (domain: string) => (domain === 'git.company.com' ? ('bitbucket' as const) : undefined),
      resolve: () => ({ getPrTool: 'a', getFilesTool: 'b', commentTool: 'c', statusTool: 'd', labelTool: 'e' }),
      buildArgs: () => ({}),
      buildCommentArgs: () => ({}),
      buildStatusArgs: () => ({}),
      buildLabelArgs: () => ({}),
    };
    const hybrid = new HybridGitProvider(
      new StubPrimary(bad),
      new StubDirect(good),
      map as unknown as StaticGitToolMap,
    );
    const out = await hybrid.fetchPullRequest({ repo: 'git.company.com/P/R', number: 1 });
    expect(out.files[0]!.patch).toContain('+new');
  });

  it('routes a self-hosted domain via the direct provider serverHost when the map lacks it', async () => {
    const bad = prWithPatch('@@ -1,3 +1,3 @@');
    const good = prWithPatch('@@ -1 +1 @@\n-old\n+new');
    const emptyMap = {
      resolveHost: (domain: string) => {
      void domain;
      return undefined;
    },
      resolve: () => ({ getPrTool: 'a', getFilesTool: 'b', commentTool: 'c', statusTool: 'd', labelTool: 'e' }),
      buildArgs: () => ({}),
      buildCommentArgs: () => ({}),
      buildStatusArgs: () => ({}),
      buildLabelArgs: () => ({}),
    };
    const direct = new StubDirect(good) as unknown as BitbucketDirectProvider;
    // StubDirect bypasses the constructor — planted host simulates BITBUCKET_URL=https://git.company.com.
    (direct as unknown as Record<string, unknown>)['serverHost'] = 'git.company.com';
    const hybrid = new HybridGitProvider(
      new StubPrimary(bad),
      direct,
      emptyMap as unknown as StaticGitToolMap,
    );
    const out = await hybrid.fetchPullRequest({ repo: 'git.company.com/P/R', number: 1 });
    expect(out.files[0]!.patch).toContain('+new');
  });

  it('does not affect github hosts', async () => {
    const good = prWithPatch('@@ -1 +1 @@\n-old\n+new');
    const hybrid = new HybridGitProvider(new StubPrimary(good), null, toolMap);
    const out = await hybrid.fetchPullRequest({ repo: 'github.com/a/b', number: 1 });
    expect(out.title).toBe('t');
  });
});
