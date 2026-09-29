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

  it('routes bitbucket-keyword domains to the Bitbucket row (self-hosted fallback)', () => {
    expect(map.resolveHost('bitbucket.company.com')).toBe(GitProviderType.Bitbucket);
  });

  it('routes explicit extra domains to the Bitbucket row', () => {
    const custom = new StaticGitToolMap(undefined, { extraBitbucketDomains: ['eu-gitp-a001.iconcr.com'] });
    expect(custom.resolveHost('eu-gitp-a001.iconcr.com')).toBe(GitProviderType.Bitbucket);
    // The default map still rejects it — explicit opt-in only.
    expect(map.resolveHost('eu-gitp-a001.iconcr.com')).toBeUndefined();
  });

  it('fromEnv reads BITBUCKET_DOMAINS and BITBUCKET_URL', () => {
    const fromList = StaticGitToolMap.fromEnv({ BITBUCKET_DOMAINS: 'git.company.com, bb.internal ' });
    expect(fromList.resolveHost('git.company.com')).toBe(GitProviderType.Bitbucket);
    expect(fromList.resolveHost('bb.internal')).toBe(GitProviderType.Bitbucket);

    const fromUrl = StaticGitToolMap.fromEnv({ BITBUCKET_URL: 'https://eu-gitp-a001.iconcr.com' });
    expect(fromUrl.resolveHost('eu-gitp-a001.iconcr.com')).toBe(GitProviderType.Bitbucket);

    const empty = StaticGitToolMap.fromEnv({});
    expect(empty.resolveHost('eu-gitp-a001.iconcr.com')).toBeUndefined();
  });

  it('returns undefined for an unknown domain', () => {
    expect(map.resolveHost('gitea.example')).toBeUndefined();
  });

  it('resolves distinct read + write tool names per host', () => {
    expect(map.resolve(GitProviderType.GitHub)).toEqual({
      getPrTool: 'get_pull_request',
      getFilesTool: 'list_pull_request_files',
      commentTool: 'add_comment',
      statusTool: 'set_pr_status',
      labelTool: 'add_labels',
    });
    expect(map.resolve(GitProviderType.GitLab)).toEqual({
      getPrTool: 'get_merge_request',
      getFilesTool: 'list_merge_request_diffs',
      commentTool: 'create_mr_note',
      statusTool: 'set_mr_status',
      labelTool: 'add_mr_labels',
    });
    expect(map.resolve(GitProviderType.Bitbucket)).toEqual({
      getPrTool: 'get_pull_request',
      getFilesTool: 'get_diff',
      commentTool: 'manage_comment',
      statusTool: 'set_pr_status',
      labelTool: 'manage_labels',
    });
  });

  it('encodes per-host read argument shapes', () => {
    expect(map.buildArgs(GitProviderType.GitHub, { owner: 'acme', name: 'api', number: 1 })).toEqual({
      owner: 'acme',
      repo: 'api',
      pull_number: 1,
    });
    expect(map.buildArgs(GitProviderType.GitLab, { owner: 'acme/sub', name: 'api', number: 7 })).toEqual({
      project_id: 'acme/sub/api',
      merge_request_iid: 7,
    });
    expect(map.buildArgs(GitProviderType.Bitbucket, { owner: 'acme', name: 'api', number: 3 })).toEqual({
      project: 'acme',
      repository: 'api',
      prId: 3,
    });
  });

  it('encodes per-host comment argument shapes', () => {
    expect(
      map.buildCommentArgs(GitProviderType.GitHub, {
        owner: 'acme',
        name: 'api',
        number: 1,
        body: 'LGTM',
      }),
    ).toEqual({ owner: 'acme', repo: 'api', issue_number: 1, body: 'LGTM' });
    expect(
      map.buildCommentArgs(GitProviderType.GitLab, {
        owner: 'acme/sub',
        name: 'api',
        number: 7,
        body: 'needs work',
      }),
    ).toEqual({ project_id: 'acme/sub/api', merge_request_iid: 7, body: 'needs work' });
    expect(
      map.buildCommentArgs(GitProviderType.Bitbucket, {
        owner: 'acme',
        name: 'api',
        number: 3,
        body: 'ship it',
      }),
    ).toEqual({ action: 'create', project: 'acme', repository: 'api', prId: 3, text: 'ship it' });
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
      issue_number: 1,
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
      project_id: 'acme/api',
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
      project: 'acme',
      repository: 'api',
      prId: 3,
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
    ).toEqual({ owner: 'acme', repo: 'api', issue_number: 1, labels: ['approved'] });
    expect(
      map.buildLabelArgs(GitProviderType.GitLab, {
        owner: 'acme',
        name: 'api',
        number: 7,
        label: 'needs-changes',
      }),
    ).toEqual({ project_id: 'acme/api', merge_request_iid: 7, label: 'needs-changes' });
    expect(
      map.buildLabelArgs(GitProviderType.Bitbucket, {
        owner: 'acme',
        name: 'api',
        number: 3,
        label: 'rfc',
      }),
    ).toEqual({ action: 'add', project: 'acme', repository: 'api', name: 'rfc' });
  });
});
