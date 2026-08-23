import { describe, expect, it } from 'vitest';

import { GitProviderType } from '@harness/domain';

import { StaticGitToolMap } from '../git-tool-map.js';

describe('StaticGitToolMap', () => {
  const map = new StaticGitToolMap();

  it('resolves each public domain to its host', () => {
    expect(map.resolveHost('github.com')).toBe(GitProviderType.GitHub);
    expect(map.resolveHost('www.github.com')).toBe(GitProviderType.GitHub);
    expect(map.resolveHost('gitlab.com')).toBe(GitProviderType.GitLab);
    expect(map.resolveHost('bitbucket.org')).toBe(GitProviderType.Bitbucket);
  });

  it('returns undefined for an unknown domain', () => {
    expect(map.resolveHost('gitea.example')).toBeUndefined();
  });

  it('resolves distinct read + write tool names per host', () => {
    expect(map.resolve(GitProviderType.GitHub)).toEqual({
      getPrTool: 'get_pull_request',
      getFilesTool: 'list_pull_request_files',
      commentTool: 'add_pr_comment',
      statusTool: 'set_pr_status',
      labelTool: 'add_pr_labels',
    });
    expect(map.resolve(GitProviderType.GitLab)).toEqual({
      getPrTool: 'get_merge_request',
      getFilesTool: 'list_merge_request_diffs',
      commentTool: 'create_mr_note',
      statusTool: 'set_mr_status',
      labelTool: 'add_mr_labels',
    });
    expect(map.resolve(GitProviderType.Bitbucket)).toEqual({
      getPrTool: 'get_pullrequest',
      getFilesTool: 'list_pullrequest_files',
      commentTool: 'add_pr_comment',
      statusTool: 'set_pr_status',
      labelTool: 'add_pr_labels',
    });
  });

  it('encodes per-host read argument shapes', () => {
    expect(
      map.buildArgs(GitProviderType.GitHub, { owner: 'acme', name: 'api', number: 1 }),
    ).toEqual({ owner: 'acme', repo: 'api', pull_number: 1 });
    expect(
      map.buildArgs(GitProviderType.GitLab, { owner: 'acme/sub', name: 'api', number: 7 }),
    ).toEqual({ project: 'acme/sub/api', merge_request_iid: 7 });
    expect(
      map.buildArgs(GitProviderType.Bitbucket, { owner: 'acme', name: 'api', number: 3 }),
    ).toEqual({ workspace: 'acme', repo_slug: 'api', pull_request_id: 3 });
  });

  it('encodes per-host comment argument shapes', () => {
    expect(
      map.buildCommentArgs(GitProviderType.GitHub, {
        owner: 'acme',
        name: 'api',
        number: 1,
        body: 'LGTM',
      }),
    ).toEqual({ owner: 'acme', repo: 'api', pull_number: 1, body: 'LGTM' });
    expect(
      map.buildCommentArgs(GitProviderType.GitLab, {
        owner: 'acme/sub',
        name: 'api',
        number: 7,
        body: 'needs work',
      }),
    ).toEqual({ project: 'acme/sub/api', merge_request_iid: 7, body: 'needs work' });
    expect(
      map.buildCommentArgs(GitProviderType.Bitbucket, {
        owner: 'acme',
        name: 'api',
        number: 3,
        body: 'ship it',
      }),
    ).toEqual({ workspace: 'acme', repo_slug: 'api', pull_request_id: 3, body: 'ship it' });
  });

  it('encodes per-host status argument shapes', () => {
    expect(
      map.buildStatusArgs(GitProviderType.GitHub, {
        owner: 'acme',
        name: 'api',
        number: 1,
        state: 'success',
        description: 'verified',
      }),
    ).toEqual({
      owner: 'acme',
      repo: 'api',
      pull_number: 1,
      state: 'success',
      description: 'verified',
    });
    expect(
      map.buildStatusArgs(GitProviderType.GitLab, {
        owner: 'acme',
        name: 'api',
        number: 7,
        state: 'failure',
        description: 'tests fail',
      }),
    ).toEqual({
      project: 'acme/api',
      merge_request_iid: 7,
      state: 'failure',
      description: 'tests fail',
    });
    expect(
      map.buildStatusArgs(GitProviderType.Bitbucket, {
        owner: 'acme',
        name: 'api',
        number: 3,
        state: 'pending',
        description: 'running',
      }),
    ).toEqual({
      workspace: 'acme',
      repo_slug: 'api',
      pull_request_id: 3,
      state: 'pending',
      description: 'running',
    });
  });

  it('encodes per-host label argument shapes', () => {
    expect(
      map.buildLabelArgs(GitProviderType.GitHub, {
        owner: 'acme',
        name: 'api',
        number: 1,
        label: 'approved',
      }),
    ).toEqual({ owner: 'acme', repo: 'api', pull_number: 1, label: 'approved' });
    expect(
      map.buildLabelArgs(GitProviderType.GitLab, {
        owner: 'acme',
        name: 'api',
        number: 7,
        label: 'needs-changes',
      }),
    ).toEqual({ project: 'acme/api', merge_request_iid: 7, label: 'needs-changes' });
    expect(
      map.buildLabelArgs(GitProviderType.Bitbucket, {
        owner: 'acme',
        name: 'api',
        number: 3,
        label: 'rfc',
      }),
    ).toEqual({ workspace: 'acme', repo_slug: 'api', pull_request_id: 3, label: 'rfc' });
  });
});
