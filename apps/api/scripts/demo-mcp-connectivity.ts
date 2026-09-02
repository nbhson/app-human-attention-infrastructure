/**
 * Week-1 connectivity demo (Phase 3 day-05 §3.2) — `pnpm demo:mcp-connectivity`.
 *
 * Fetches a PR/MR from GitHub, GitLab, and Bitbucket plus a Jira issue, *all*
 * through one `@harness/mcp` client + one `mcp.config.json` — no per-host REST
 * adapter. Every host is fronted by its MCP server via `resolveReviewInput`, and
 * the result is printed so the MCP thesis ("one config connects any tool") is
 * demonstrable, not asserted.
 *
 * Runs stubbed by default (in-repo `forge-server.mjs` stdio subprocess, no live
 * credentials). `--live` switches to the real `<repo root>/mcp.config.json`; it
 * refuses to run if that file (git-ignored) is absent or empty, and needs the
 * `*_TOKEN` env vars the config references.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { loadMcpConfig, McpServerRegistryImpl, parseMcpConfig } from '@harness/mcp';
import type { McpServerRegistry } from '@harness/mcp';
import type { PullRequest, Issue } from '@harness/domain';

import { resolveReviewInput } from '../src/review-input-facade.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FORGE_STUB = fileURLToPath(
  new URL('../../../packages/mcp/src/__tests__/stub-servers/forge-server.mjs', import.meta.url),
);

/** The four checkout URLs exercised, chosen to match the stub fixtures. */
const FORGE_URLS: readonly string[] = [
  'https://github.com/acme/widget/pull/1',
  'https://gitlab.com/acme/widget/-/merge_requests/7',
  'https://bitbucket.org/acme/widget/pull-requests/3',
];

const JIRA_KEY = 'ACME-42';

function isLive(): boolean {
  return process.argv.includes('--live');
}

function buildRegistry(live: boolean): McpServerRegistry {
  if (live) {
    const config = loadMcpConfig(join(REPO_ROOT, 'mcp.config.json'));
    if (config.servers.length === 0) {
      console.error(
        '[demo:mcp-connectivity] --live: no mcp.config.json at the repo root. ' +
          'Copy mcp.config.example.json, set the *_TOKEN env vars, and re-run — ' +
          'or run without --live for the stubbed demo.',
      );
      process.exit(1);
    }
    return new McpServerRegistryImpl(config);
  }
  const stdio = { transport: 'stdio', command: process.execPath, args: [FORGE_STUB] };
  return new McpServerRegistryImpl(
    parseMcpConfig(JSON.stringify({ servers: { github: stdio, gitlab: stdio, bitbucket: stdio, jira: stdio } }), {}),
  );
}

function printPr(pr: PullRequest): void {
  const first = pr.files[0];
  console.log(`  repo:    ${pr.repo}#${pr.number}  (provider=${pr.provider})`);
  console.log(`  title:   "${pr.title}"`);
  console.log(`  files:   ${pr.files.length}`);
  if (first) {
    console.log(`  first:   ${first.path} (${first.status}, +${first.additions} -${first.deletions})`);
  }
  console.log();
}

function printIssue(issue: Issue): void {
  console.log(`  key:     ${issue.key}  (provider=${issue.provider})`);
  console.log(`  summary: "${issue.summary}"`);
  console.log(`  type:    ${issue.issueType}`);
  console.log(`  url:     ${issue.url}`);
  console.log();
}

async function main(): Promise<void> {
  const live = isLive();
  const registry = buildRegistry(live);
  const jiraBaseUrl = process.env.JIRA_BASE_URL ?? 'https://acme.atlassian.net';

  console.log();
  console.log(`demo:mcp-connectivity — mode=${live ? 'live (mcp.config.json)' : 'stubbed (forge-server.mjs)'}`);
  console.log('one @harness/mcp client + one mcp.config.json fronts GitHub, GitLab, Bitbucket, and Jira');
  console.log('— no per-host REST SDK.');
  console.log();

  try {
    for (const prUrl of FORGE_URLS) {
      console.log(`=== ${new URL(prUrl).host} ===`);
      const { pullRequest } = await resolveReviewInput({ prUrl }, { registry, jiraBaseUrl });
      printPr(pullRequest);
    }

    console.log('=== Jira ===');
    const { issue } = await resolveReviewInput({ prUrl: FORGE_URLS[0]!, jiraKey: JIRA_KEY }, { registry, jiraBaseUrl });
    if (issue === undefined) {
      throw new Error('expected a Jira issue to be resolved');
    }
    printIssue(issue);

    console.log('week-1 milestone: PR/MR from GitHub + GitLab + Bitbucket and a Jira issue,');
    console.log('all fetched through one mcp.config.json via @harness/mcp. ✅');
  } finally {
    await registry.closeAll();
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('[demo:mcp-connectivity] FAILED:', err);
    process.exit(1);
  },
);
