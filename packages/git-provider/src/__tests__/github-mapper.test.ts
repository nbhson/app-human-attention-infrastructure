import { describe, expect, it } from 'vitest';

import { GitProviderType } from '@harness/domain';

import { parseRepoPath, GitProviderError } from '../git-provider.js';
import { mapGithubPullRequest } from '../github-mapper.js';
import type { GithubPullPayload, GithubPrFilePayload } from '../github-mapper.js';

describe('parseRepoPath', () => {
  it('splits host/owner/name', () => {
    expect(parseRepoPath('github.com/acme/api')).toEqual({
      host: 'github.com',
      owner: 'acme',
      name: 'api',
    });
  });

  it('keeps grouped/nested owners intact', () => {
    expect(parseRepoPath('gitlab.com/group/subgroup/api')).toEqual({
      host: 'gitlab.com',
      owner: 'group/subgroup',
      name: 'api',
    });
  });

  it('rejects an under-specified path', () => {
    expect(() => parseRepoPath('github.com/acme')).toThrow(GitProviderError);
  });
});

const meta: GithubPullPayload = {
  number: 482,
  title: 'Fix the retry loop',
  body: 'Closes ACME-1234',
  user: { login: 'acme-dev' },
  head: { ref: 'fix/retry', sha: 'abc123' },
  base: { ref: 'main', sha: 'def456' },
  html_url: 'https://github.com/acme/api/pull/482',
};

const files: GithubPrFilePayload[] = [
  { filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, patch: '@@ ... @@' },
  { filename: 'src/b.ts', status: 'added', additions: 10, deletions: 0, patch: null },
];

describe('mapGithubPullRequest', () => {
  it('maps metadata and file statuses', () => {
    const pr = mapGithubPullRequest(GitProviderType.GitHub, 'github.com/acme/api', meta, files);

    expect(pr.number).toBe(482);
    expect(pr.author).toBe('acme-dev');
    expect(pr.base.ref).toBe('main');
    expect(pr.head.sha).toBe('abc123');
    expect(pr.files).toHaveLength(2);
    expect(pr.files[0]?.status).toBe('MODIFIED');
    expect(pr.files[1]?.status).toBe('CREATED');
    expect(pr.files[1]?.patch).toBe('');
  });
});
