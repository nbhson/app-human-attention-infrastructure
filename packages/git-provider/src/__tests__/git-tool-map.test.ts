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

  it('resolves distinct tool names per host', () => {
    expect(map.resolve(GitProviderType.GitHub)).toEqual({
      getPrTool: 'get_pull_request',
      getFilesTool: 'list_pull_request_files',
    });
    expect(map.resolve(GitProviderType.GitLab)).toEqual({
      getPrTool: 'get_merge_request',
      getFilesTool: 'list_merge_request_diffs',
    });
    expect(map.resolve(GitProviderType.Bitbucket)).toEqual({
      getPrTool: 'get_pullrequest',
      getFilesTool: 'list_pullrequest_files',
    });
  });

  it('encodes per-host argument shapes', () => {
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
});
