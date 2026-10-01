import { describe, expect, it } from 'vitest';

import { GitProviderType } from '@harness/domain';
import type { ToolResult } from '@harness/mcp';

import { GitProviderError } from '../git-provider.js';
import { mapMcpGitPullRequest } from '../mcp-git-mapper.js';

function textResult(json: unknown, isError = false): ToolResult {
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(json) }],
  };
}

const PR_PAYLOAD = {
  number: 42,
  title: 'Add the thing',
  description: 'closes AC-1',
  author: 'alice',
  head: { ref: 'feature/thing', sha: 'head-sha' },
  base: { ref: 'main', sha: 'base-sha' },
  url: 'https://github.com/acme/api/pull/42',
};

const FILES_PAYLOAD = [
  { path: 'src/a.ts', status: 'modified', additions: 10, deletions: 2, patch: '@@ -1 +1 @@' },
  { path: 'src/b.ts', status: 'added', additions: 5, deletions: 0, patch: '@@ -0,0 +1 @@' },
];

describe('mapMcpGitPullRequest', () => {
  it('assembles a PullRequest identical to the REST mapper output', () => {
    const pr = mapMcpGitPullRequest(
      GitProviderType.GitHub,
      'github.com/acme/api',
      textResult(PR_PAYLOAD),
      textResult(FILES_PAYLOAD),
    );

    expect(pr).toEqual({
      provider: 'github',
      number: 42,
      title: 'Add the thing',
      description: 'closes AC-1',
      author: 'alice',
      sourceBranch: 'feature/thing',
      targetBranch: 'main',
      base: { ref: 'main', sha: 'base-sha', repo: 'github.com/acme/api' },
      head: { ref: 'feature/thing', sha: 'head-sha', repo: 'github.com/acme/api' },
      url: 'https://github.com/acme/api/pull/42',
      repo: 'github.com/acme/api',
      files: [
        {
          path: 'src/a.ts',
          status: 'MODIFIED',
          additions: 10,
          deletions: 2,
          patch: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@',
        },
        {
          path: 'src/b.ts',
          status: 'CREATED',
          additions: 5,
          deletions: 0,
          patch: 'diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -0,0 +1 @@',
        },
      ],
    });
  });

  it('defaults description, additions/deletions, patch when omitted', () => {
    const pr = mapMcpGitPullRequest(
      GitProviderType.GitHub,
      'github.com/acme/api',
      textResult({ ...PR_PAYLOAD, description: null }),
      textResult([{ filename: 'x.ts', status: 'removed' }]),
    );
    expect(pr.description).toBe('');
    expect(pr.files[0]).toEqual({
      path: 'x.ts',
      status: 'DELETED',
      additions: 0,
      deletions: 0,
      patch: '',
    });
  });

  it('accepts a { files } wrapper and `renamed` status token', () => {
    const pr = mapMcpGitPullRequest(
      GitProviderType.GitHub,
      'github.com/acme/api',
      textResult(PR_PAYLOAD),
      textResult({ files: [{ path: 'y.ts', status: 'renamed' }] }),
    );
    expect(pr.files[0]!.status).toBe('RENAMED');
  });

  it('throws when a tool returns isError', () => {
    expect(() =>
      mapMcpGitPullRequest(
        GitProviderType.GitHub,
        'github.com/acme/api',
        textResult(PR_PAYLOAD, true),
        textResult(FILES_PAYLOAD),
      ),
    ).toThrow(GitProviderError);
  });

  it('throws on malformed content (no JSON payload)', () => {
    const result: ToolResult = { isError: false, content: [{ type: 'text', text: 'not json' }] };
    expect(() => mapMcpGitPullRequest(GitProviderType.GitHub, 'github.com/acme/api', result, textResult([]))).toThrow(
      /no JSON payload/,
    );
  });

  it('throws on a missing required PR field', () => {
    expect(() =>
      mapMcpGitPullRequest(
        GitProviderType.GitHub,
        'github.com/acme/api',
        textResult({ ...PR_PAYLOAD, title: undefined }),
        textResult(FILES_PAYLOAD),
      ),
    ).toThrow(/title/);
  });

  it('throws on a file entry missing its path', () => {
    expect(() =>
      mapMcpGitPullRequest(
        GitProviderType.GitHub,
        'github.com/acme/api',
        textResult(PR_PAYLOAD),
        textResult([{ status: 'modified' }]),
      ),
    ).toThrow(/path/);
  });

  it('throws on an unknown file status token', () => {
    expect(() =>
      mapMcpGitPullRequest(
        GitProviderType.GitHub,
        'github.com/acme/api',
        textResult(PR_PAYLOAD),
        textResult([{ path: 'z.ts', status: 'conflicted' }]),
      ),
    ).toThrow(/conflicted/);
  });

  it('maps a Bitbucket Server PR payload (fromRef/toRef, author.user, links.self)', () => {
    const pr = mapMcpGitPullRequest(
      GitProviderType.Bitbucket,
      'git.company.com/SP0168/horizon2-ui',
      textResult({
        id: 2847,
        title: 'Feature: horizon filters',
        description: 'Implements the filter panel.',
        state: 'OPEN',
        author: { user: { name: 'jdoe', displayName: 'Jane Doe' } },
        fromRef: { id: 'refs/heads/feature/filters', displayId: 'feature/filters', latestCommit: 'aaa' },
        toRef: { id: 'refs/heads/main', displayId: 'main', latestCommit: 'bbb' },
        links: { self: [{ href: 'https://git.company.com/projects/SP0168/repos/horizon2-ui/pull-requests/2847' }] },
      }),
      textResult(FILES_PAYLOAD),
    );
    expect(pr.number).toBe(2847);
    expect(pr.author).toBe('Jane Doe');
    expect(pr.sourceBranch).toBe('feature/filters');
    expect(pr.targetBranch).toBe('main');
    expect(pr.head.sha).toBe('aaa');
    expect(pr.url).toContain('/pull-requests/2847');
  });

  it('maps a Bitbucket Cloud PR payload (source/destination, links.html)', () => {
    const pr = mapMcpGitPullRequest(
      GitProviderType.Bitbucket,
      'bitbucket.org/acme/widget',
      textResult({
        id: 3,
        title: 'Cloud fix',
        description: 'A cloud PR.',
        author: { display_name: 'carol' },
        source: { branch: { name: 'feature/x' }, commit: { hash: 'ccc' } },
        destination: { branch: { name: 'main' }, commit: { hash: 'ddd' } },
        links: { html: { href: 'https://bitbucket.org/acme/widget/pull-requests/3' } },
      }),
      textResult(FILES_PAYLOAD),
    );
    expect(pr.number).toBe(3);
    expect(pr.author).toBe('carol');
    expect(pr.sourceBranch).toBe('feature/x');
    expect(pr.head.sha).toBe('ccc');
  });

  it('parses raw unified diff text for the get-files tool', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    const pr = mapMcpGitPullRequest(GitProviderType.Bitbucket, 'bitbucket.org/acme/widget', textResult(PR_PAYLOAD), {
      isError: false,
      content: [{ type: 'text', text: diff }],
    });
    expect(pr.files).toEqual([{ path: 'src/a.ts', status: 'MODIFIED', additions: 1, deletions: 1, patch: diff }]);
  });

  it('still throws loudly on garbage get-files text', () => {
    const garbage: ToolResult = { isError: false, content: [{ type: 'text', text: 'No changes.' }] };
    expect(() =>
      mapMcpGitPullRequest(GitProviderType.Bitbucket, 'bitbucket.org/acme/widget', textResult(PR_PAYLOAD), garbage),
    ).toThrow(/no unified-diff file blocks/);
  });

  it('parses Bitbucket Server {diffs} with RestDiffLine objects (not bare strings)', () => {
    // Real Server/DC get_diff returns lines as { source, destination, line }.
    // The old parser dropped them (`typeof line !== "string"`), leaving only
    // `@@` headers with +0/-0 — the "Diff tab shows file but no content" bug.
    const serverDiff = {
      diffs: [
        {
          source: {
            toString: 'src/app/shared/common/template.html',
          },
          destination: {
            toString: 'src/app/shared/common/template.html',
          },
          hunks: [
            {
              sourceLine: 229,
              sourceSpan: 23,
              destinationLine: 229,
              destinationSpan: 27,
              segments: [
                {
                  type: 'CONTEXT',
                  lines: [{ source: 229, destination: 229, line: '<div>context</div>' }],
                },
                {
                  type: 'REMOVED',
                  lines: [{ source: 230, line: '<old-line></old-line>' }],
                },
                {
                  type: 'ADDED',
                  lines: [
                    { destination: 230, line: '<new-line-1></new-line-1>' },
                    { destination: 231, line: '<new-line-2></new-line-2>' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const pr = mapMcpGitPullRequest(
      GitProviderType.Bitbucket,
      'git.company.com/P/R',
      textResult(PR_PAYLOAD),
      textResult(serverDiff),
    );
    expect(pr.files).toHaveLength(1);
    expect(pr.files[0]!.additions).toBe(2);
    expect(pr.files[0]!.deletions).toBe(1);
    expect(pr.files[0]!.patch).toContain('@@ -229,23 +229,27 @@');
    expect(pr.files[0]!.patch).toContain('+<new-line-1>');
    expect(pr.files[0]!.patch).toContain('-<old-line>');
    expect(pr.files[0]!.patch).toContain(' <div>context</div>');
  });
});
