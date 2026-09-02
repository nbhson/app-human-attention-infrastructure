/**
 * `MCPGitProvider` (Phase 3 day-03) — one {@link GitProvider} that fronts *any*
 * Git MCP server, instead of a REST adapter per forge.
 *
 * The transport changed, the seam stayed: the fetch path resolves the repo slug
 * to a host, drives that host's mapped tools through the registry, and maps the
 * `ToolResult`s to the same {@link PullRequest} shape the Phase-1
 * `GitHubProvider` produced. "Add GitLab/Bitbucket" is a `mcp.config.json` entry
 * + a `GitToolMap` row — not a new class (day-03 §1, §2).
 *
 * Write primitives (`postComment`/`setStatus`) are the Day-06 write-back week
 * (the same MCP tools); today they fail loudly rather than silently no-op.
 */

import type { PullRequest } from '@harness/domain';
import { McpConfigError } from '@harness/mcp';
import type { McpClient, McpServerRegistry } from '@harness/mcp';

import { GitProviderError, parseRepoPath } from './git-provider.js';
import type { CloneInput, CloneResult, FetchPullRequestInput, GitProvider } from './git-provider.js';
import { cloneAndCheckout } from './clone.js';
import { mapMcpGitPullRequest } from './mcp-git-mapper.js';
import type { GitHost, GitToolMap } from './git-tool-map.js';

/** The repo slug routed to a host with no configured MCP server. */
export class UnknownProviderHostError extends GitProviderError {
  constructor(host: string) {
    super(`no Git MCP provider for host "${host}"`);
    this.name = 'UnknownProviderHostError';
  }
}

export class MCPGitProvider implements GitProvider {
  constructor(
    private readonly registry: McpServerRegistry,
    private readonly toolMap: GitToolMap,
  ) {}

  async fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest> {
    const { host, owner, name } = parseRepoPath(input.repo);
    const gitHost = this.toolMap.resolveHost(host);
    if (gitHost === undefined) {
      throw new UnknownProviderHostError(host);
    }
    const client = await this.clientFor(gitHost);
    const { getPrTool, getFilesTool } = this.toolMap.resolve(gitHost);
    const args = this.toolMap.buildArgs(gitHost, { owner, name, number: input.number });

    const [prResult, filesResult] = await Promise.all([
      client.callTool(getPrTool, args),
      client.callTool(getFilesTool, args),
    ]);

    return mapMcpGitPullRequest(gitHost, input.repo, prResult, filesResult);
  }

  async postComment(input: FetchPullRequestInput, body: string): Promise<void> {
    void input;
    void body;
    throw new GitProviderError('MCP Git write-back (postComment) is not wired until Day 06');
  }

  async setStatus(
    input: FetchPullRequestInput,
    state: 'pending' | 'success' | 'failure',
    description: string,
  ): Promise<void> {
    void input;
    void state;
    void description;
    throw new GitProviderError('MCP Git write-back (setStatus) is not wired until Day 06');
  }

  async cloneAndCheckout(input: CloneInput, workdir: string): Promise<CloneResult> {
    // The clone/checkout is provider-agnostic (git is the same tool on every
    // host); the head SHA was already resolved into `input` by the fetch path.
    return cloneAndCheckout(input, workdir);
  }

  /** A domain that resolves to a known host but has no config entry is "unknown". */
  private async clientFor(host: GitHost): Promise<McpClient> {
    try {
      return await this.registry.get(host);
    } catch (error) {
      if (error instanceof McpConfigError) {
        throw new UnknownProviderHostError(host);
      }
      throw error;
    }
  }
}
