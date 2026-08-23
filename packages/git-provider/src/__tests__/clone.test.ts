import { describe, expect, it } from 'vitest';

import type { GitProviderType, PullRequest } from '@harness/domain';

import { GitProviderError } from '../git-provider.js';
import { cloneAndCheckout, CloneError } from '../clone.js';
import type { RunGit } from '../clone.js';
import { cloneInputFromPullRequest, resolveHeadSha } from '../head-sha.js';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    provider: 'github' as GitProviderType,
    number: 42,
    title: 'Add the thing',
    description: '',
    author: 'alice',
    sourceBranch: 'feature/x',
    targetBranch: 'main',
    base: { ref: 'main', sha: BASE_SHA, repo: 'github.com/acme/api' },
    head: { ref: 'feature/x', sha: HEAD_SHA, repo: 'github.com/acme/api' },
    url: 'https://github.com/acme/api/pull/42',
    repo: 'github.com/acme/api',
    files: [],
    ...overrides,
  };
}

/** A runner that records every invocation and can be made to fail a given step. */
function recordingRunner(failAt?: number): {
  run: RunGit;
  calls: Array<{ args: string[]; cwd?: string }>;
} {
  const calls: Array<{ args: string[]; cwd?: string }> = [];
  let index = 0;
  const run: RunGit = async (args, opts) => {
    calls.push({ args: [...args], ...(opts?.cwd === undefined ? {} : { cwd: opts.cwd }) });
    const step = index++;
    if (failAt !== undefined && step === failAt) {
      return { exitCode: 128, stdout: '', stderr: 'fatal: not our ref' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

describe('cloneAndCheckout', () => {
  it('shallow-clones the source branch, fetches the head SHA, and detach-checks-out it', async () => {
    const { run, calls } = recordingRunner();
    const input = {
      repo: 'github.com/acme/api',
      number: 42,
      headSha: HEAD_SHA,
      sourceBranch: 'feature/x',
      targetBranch: 'main',
    };

    const result = await cloneAndCheckout(input, '/tmp/worktree', { run });

    expect(result).toEqual({
      workdir: '/tmp/worktree',
      headSha: HEAD_SHA,
      sourceBranch: 'feature/x',
      targetBranch: 'main',
    });
    expect(calls[0]).toEqual({
      args: [
        'clone',
        '--depth',
        '1',
        '--no-tags',
        '--branch',
        'feature/x',
        'https://github.com/acme/api.git',
        '/tmp/worktree',
      ],
    });
    expect(calls[1]).toEqual({
      args: ['fetch', '--depth', '1', 'origin', HEAD_SHA],
      cwd: '/tmp/worktree',
    });
    expect(calls[2]).toEqual({ args: ['checkout', '--detach', HEAD_SHA], cwd: '/tmp/worktree' });
  });

  it('never checks out main — the head-SHA checkout is a detached ref by construction', async () => {
    const { run, calls } = recordingRunner();
    await cloneAndCheckout(
      {
        repo: 'github.com/acme/api',
        number: 42,
        headSha: HEAD_SHA,
        sourceBranch: 'feature/x',
        targetBranch: 'main',
      },
      '/tmp/worktree',
      { run },
    );

    // The only checkout is detach-at-SHA; the target branch (main) is never a
    // checkout target. `main` must not appear in the fetch/checkout steps at all.
    const refs = calls.slice(1).flatMap((c) => c.args);
    expect(refs).not.toContain('main');
    expect(calls[2]?.args).toEqual(['checkout', '--detach', HEAD_SHA]);
  });

  it('shallow-clones with a single-branch and no tags (never the full history)', async () => {
    const { run, calls } = recordingRunner();
    await cloneAndCheckout(
      {
        repo: 'gitlab.com/group/sub/api',
        number: 7,
        headSha: HEAD_SHA,
        sourceBranch: 'fix/bug',
        targetBranch: 'main',
      },
      '/tmp/wd',
      { run },
    );

    expect(calls[0]?.args).toContain('--depth');
    expect(calls[0]?.args).toContain('1');
    expect(calls[0]?.args).toContain('--no-tags');
    expect(calls[0]?.args).toContain('https://gitlab.com/group/sub/api.git');
  });

  it('wraps a non-zero git exit in a CloneError carrying the failing command', async () => {
    const { run } = recordingRunner(1); // fail the `fetch` step
    await expect(
      cloneAndCheckout(
        {
          repo: 'github.com/acme/api',
          number: 42,
          headSha: HEAD_SHA,
          sourceBranch: 'feature/x',
          targetBranch: 'main',
        },
        '/tmp/wd',
        { run },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('git fetch failed') });
  });

  it('treats a 124 (timed-out / killed) exit as a CloneError', async () => {
    const run: RunGit = async () => ({ exitCode: 124, stdout: '', stderr: 'killed' });
    await expect(
      cloneAndCheckout(
        {
          repo: 'github.com/acme/api',
          number: 42,
          headSha: HEAD_SHA,
          sourceBranch: 'feature/x',
          targetBranch: 'main',
        },
        '/tmp/wd',
        { run },
      ),
    ).rejects.toBeInstanceOf(CloneError);
  });
});

describe('resolveHeadSha / cloneInputFromPullRequest', () => {
  it('extracts the head SHA for each forge from the normalised PullRequest', () => {
    expect(resolveHeadSha(pullRequest({ provider: 'github' }))).toBe(HEAD_SHA);
    expect(resolveHeadSha(pullRequest({ provider: 'gitlab' }))).toBe(HEAD_SHA);
    expect(resolveHeadSha(pullRequest({ provider: 'bitbucket' }))).toBe(HEAD_SHA);
  });

  it('trims whitespace but rejects an empty or non-SHA head', () => {
    expect(resolveHeadSha(pullRequest())).toBe(HEAD_SHA);
    expect(() =>
      resolveHeadSha(pullRequest({ head: { ref: 'feature/x', sha: '  ', repo: 'x/y/z' } })),
    ).toThrow(GitProviderError);
    expect(() =>
      resolveHeadSha(pullRequest({ head: { ref: 'feature/x', sha: 'not-a-sha', repo: 'x/y/z' } })),
    ).toThrow(GitProviderError);
  });

  it('builds CloneInput with the resolved SHA and both branch names', () => {
    expect(cloneInputFromPullRequest(pullRequest())).toEqual({
      repo: 'github.com/acme/api',
      number: 42,
      headSha: HEAD_SHA,
      sourceBranch: 'feature/x',
      targetBranch: 'main',
    });
  });
});
