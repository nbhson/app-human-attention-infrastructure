/**
 * Seam-parity sanity test (day-05 §3.4) — the Week-1 checkpoint that proves the
 * MCP providers produce a {@link PullRequest} / {@link Issue} structurally
 * identical to the Phase-1 REST outputs, for *all three* Git hosts + Jira in one
 * run.
 *
 * Days 03–04 unit-tested the mappers in isolation. Here a real
 * {@link McpServerRegistry} fronts a single in-repo stub (`forge-server.mjs`)
 * under four server names, and `resolveReviewInput` fetches through it — so the
 * mapper + provider + registry + facade are exercised together against the shared
 * shapes. No live token, no network: the stub is a stdio subprocess.
 */

import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseMcpConfig, McpServerRegistryImpl } from '@harness/mcp';
import type { McpServerRegistry } from '@harness/mcp';
import type { Issue, PullRequest } from '@harness/domain';
import { GitProviderType } from '@harness/domain';

import { resolveReviewInput } from '../review-input-facade.js';
import { StaticGitToolMap } from '@harness/git-provider';

const FORGE_STUB = fileURLToPath(
  new URL('../../../../packages/mcp/src/__tests__/stub-servers/forge-server.mjs', import.meta.url),
);

/** Custom tool map with prefixed tool names matching the shared stub server. */
const TEST_GIT_TOOL_MAP = new StaticGitToolMap([
  {
    host: GitProviderType.GitHub,
    domains: ['github.com'],
    getPrTool: 'github_get_pull_request',
    getFilesTool: 'github_list_pull_request_files',
    commentTool: 'github_add_comment',
    statusTool: 'github_set_pr_status',
    labelTool: 'github_add_labels',
    buildArgs: ({ owner, name, number }) => ({ owner, repo: name, pull_number: number }),
    buildCommentArgs: ({ owner, name, number, body }) => ({ owner, repo: name, issue_number: number, body }),
    buildStatusArgs: ({ owner, name, number, state, description }) => ({
      owner,
      repo: name,
      issue_number: number,
      state,
      description,
    }),
    buildLabelArgs: ({ owner, name, number, label }) => ({ owner, repo: name, issue_number: number, labels: [label] }),
  },
  {
    host: GitProviderType.GitLab,
    domains: ['gitlab.com'],
    getPrTool: 'gitlab_get_merge_request',
    getFilesTool: 'gitlab_list_merge_request_diffs',
    commentTool: 'gitlab_create_mr_note',
    statusTool: 'gitlab_set_mr_status',
    labelTool: 'gitlab_add_mr_labels',
    buildArgs: ({ owner, name, number }) => ({ project_id: `${owner}/${name}`, merge_request_iid: number }),
    buildCommentArgs: ({ owner, name, number, body }) => ({
      project_id: `${owner}/${name}`,
      merge_request_iid: number,
      body,
    }),
    buildStatusArgs: ({ owner, name, number, state, description }) => ({
      project_id: `${owner}/${name}`,
      merge_request_iid: number,
      state,
      description,
    }),
    buildLabelArgs: ({ owner, name, number, label }) => ({
      project_id: `${owner}/${name}`,
      merge_request_iid: number,
      label,
    }),
  },
  {
    host: GitProviderType.Bitbucket,
    domains: ['bitbucket.org'],
    getPrTool: 'bitbucket_get_pull_request',
    getFilesTool: 'bitbucket_get_diff',
    commentTool: 'bitbucket_addPullRequestComment',
    statusTool: 'bitbucket_set_pr_status',
    labelTool: 'bitbucket_manage_labels',
    buildArgs: ({ owner, name, number }) => ({ project: owner, repository: name, prId: number }),
    buildCommentArgs: ({ owner, name, number, body }) => ({
      action: 'create',
      project: owner,
      repository: name,
      prId: number,
      text: body,
    }),
    buildStatusArgs: ({ owner, name, number, state, description }) => ({
      project: owner,
      repository: name,
      prId: number,
      state,
      description,
    }),
    buildLabelArgs: ({ owner, name, label }) => ({ action: 'add', project: owner, repository: name, name: label }),
  },
]);

/** A secret-free `mcp.config.json` pointing all four server names at the one stub. */
function stubConfig(): ReturnType<typeof parseMcpConfig> {
  const stdio = { transport: 'stdio', command: process.execPath, args: [FORGE_STUB] };
  return parseMcpConfig(
    JSON.stringify({
      servers: { github: stdio, gitlab: stdio, bitbucket: stdio, jira: stdio },
    }),
    {},
  );
}

/**
 * The shared shape validator (day-05 §3.4): one assertion passed by every host.
 * It checks the *field caste* of the mapped output against the Phase-1
 * {@link PullRequest} contract, so a stub that returns something the mapper
 * would reject fails loudly here rather than in the demo.
 */
function assertPullRequestShape(pr: PullRequest, provider: string): void {
  expect(pr.provider).toBe(provider);
  expect(pr.number).toEqual(expect.any(Number));
  expect(pr.title).toEqual(expect.any(String));
  expect(pr.author).toEqual(expect.any(String));
  expect(pr.url).toBeTypeOf('string');
  expect(pr.repo).toBeTypeOf('string');
  expect(pr.sourceBranch).toBeTypeOf('string');
  expect(pr.targetBranch).toBeTypeOf('string');
  expect(pr.base).toMatchObject({
    ref: expect.any(String),
    sha: expect.any(String),
    repo: pr.repo,
  });
  expect(pr.head).toMatchObject({
    ref: expect.any(String),
    sha: expect.any(String),
    repo: pr.repo,
  });
  expect(pr.files.length).toBeGreaterThan(0);
  for (const file of pr.files) {
    expect(file).toMatchObject({
      path: expect.any(String),
      status: expect.stringMatching(/^(CREATED|MODIFIED|DELETED|RENAMED)$/),
      additions: expect.any(Number),
      deletions: expect.any(Number),
      patch: expect.any(String),
    });
  }
}

/** The shared issue validator passed by the Jira fetch. */
function assertIssueShape(issue: Issue): void {
  expect(issue.provider).toBe('jira');
  expect(issue.key).toBe('ACME-42');
  expect(issue.summary).toEqual(expect.any(String));
  expect(issue.description).toEqual(expect.any(String));
  expect(issue.issueType).toBeTypeOf('string');
  expect(issue.url).toBeTypeOf('string');
}

describe('resolveReviewInput seam parity (all hosts via MCP)', () => {
  let registry: McpServerRegistry;

  beforeAll(() => {
    registry = new McpServerRegistryImpl(stubConfig());
  });

  afterAll(async () => {
    await registry.closeAll();
  });

  it('maps a GitHub PR to the Phase-1 PullRequest shape', async () => {
    const { pullRequest, issue } = await resolveReviewInput(
      { prUrl: 'https://github.com/acme/widget/pull/1' },
      { registry, gitToolMap: TEST_GIT_TOOL_MAP },
    );
    assertPullRequestShape(pullRequest, 'github');
    expect(pullRequest.repo).toBe('github.com/acme/widget');
    expect(pullRequest.number).toBe(1);
    expect(issue).toBeUndefined();
  });

  it('maps a GitLab MR to the Phase-1 PullRequest shape', async () => {
    const { pullRequest } = await resolveReviewInput(
      { prUrl: 'https://gitlab.com/acme/widget/-/merge_requests/7' },
      { registry, gitToolMap: TEST_GIT_TOOL_MAP },
    );
    assertPullRequestShape(pullRequest, 'gitlab');
    expect(pullRequest.repo).toBe('gitlab.com/acme/widget');
    expect(pullRequest.number).toBe(7);
  });

  it('maps a Bitbucket PR to the Phase-1 PullRequest shape', async () => {
    const { pullRequest } = await resolveReviewInput(
      { prUrl: 'https://bitbucket.org/acme/widget/pull-requests/3' },
      { registry, gitToolMap: TEST_GIT_TOOL_MAP },
    );
    assertPullRequestShape(pullRequest, 'bitbucket');
    expect(pullRequest.repo).toBe('bitbucket.org/acme/widget');
    expect(pullRequest.number).toBe(3);
  });

  it('maps a Jira issue fetched alongside the PR to the Phase-1 Issue shape', async () => {
    const { pullRequest, issue } = await resolveReviewInput(
      { prUrl: 'https://github.com/acme/widget/pull/1', jiraKey: 'ACME-42' },
      { registry, jiraBaseUrl: 'https://acme.atlassian.net', gitToolMap: TEST_GIT_TOOL_MAP },
    );
    expect(issue).toBeDefined();
    assertPullRequestShape(pullRequest, 'github');
    assertIssueShape(issue!);
    expect(issue!.url).toBe('https://acme.atlassian.net/browse/ACME-42');
  });
});
