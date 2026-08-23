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
        { path: 'src/a.ts', status: 'MODIFIED', additions: 10, deletions: 2, patch: '@@ -1 +1 @@' },
        { path: 'src/b.ts', status: 'CREATED', additions: 5, deletions: 0, patch: '@@ -0,0 +1 @@' },
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
    expect(() =>
      mapMcpGitPullRequest(GitProviderType.GitHub, 'github.com/acme/api', result, textResult([])),
    ).toThrow(/no JSON payload/);
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
});
