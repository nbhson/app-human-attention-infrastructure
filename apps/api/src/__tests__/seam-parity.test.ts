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

import { resolveReviewInput } from '../review-input-facade.js';

const FORGE_STUB = fileURLToPath(
  new URL('../../../../packages/mcp/src/__tests__/stub-servers/forge-server.mjs', import.meta.url),
);

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
      { registry },
    );
    assertPullRequestShape(pullRequest, 'github');
    expect(pullRequest.repo).toBe('github.com/acme/widget');
    expect(pullRequest.number).toBe(1);
    expect(issue).toBeUndefined();
  });

  it('maps a GitLab MR to the Phase-1 PullRequest shape', async () => {
    const { pullRequest } = await resolveReviewInput(
      { prUrl: 'https://gitlab.com/acme/widget/-/merge_requests/7' },
      { registry },
    );
    assertPullRequestShape(pullRequest, 'gitlab');
    expect(pullRequest.repo).toBe('gitlab.com/acme/widget');
    expect(pullRequest.number).toBe(7);
  });

  it('maps a Bitbucket PR to the Phase-1 PullRequest shape', async () => {
    const { pullRequest } = await resolveReviewInput(
      { prUrl: 'https://bitbucket.org/acme/widget/pull-requests/3' },
      { registry },
    );
    assertPullRequestShape(pullRequest, 'bitbucket');
    expect(pullRequest.repo).toBe('bitbucket.org/acme/widget');
    expect(pullRequest.number).toBe(3);
  });

  it('maps a Jira issue fetched alongside the PR to the Phase-1 Issue shape', async () => {
    const { pullRequest, issue } = await resolveReviewInput(
      { prUrl: 'https://github.com/acme/widget/pull/1', jiraKey: 'ACME-42' },
      { registry, jiraBaseUrl: 'https://acme.atlassian.net' },
    );
    expect(issue).toBeDefined();
    assertPullRequestShape(pullRequest, 'github');
    assertIssueShape(issue!);
    expect(issue!.url).toBe('https://acme.atlassian.net/browse/ACME-42');
  });
});
