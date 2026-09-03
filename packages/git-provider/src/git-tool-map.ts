/**
 * `GitToolMap` — the capability→tool-name binding that makes "add a Git forge"
 * a single table entry instead of a REST adapter.
 *
 * Different Git MCP servers name the same capability differently
 * (`get_pull_request` vs `get_merge_request` vs `get_pullrequest`) and take
 * different argument shapes (`pull_number` vs `merge_request_iid` vs
 * `pull_request_id`). This map is the *only* place that variance lives:
 * {@link MCPGitProvider} asks "which host does this repo slug resolve to?" and
 * then drives that host's tools through the map — never special-casing host
 * strings itself (day-03 §2.2, §6).
 *
 * Day-06 extends the table with the *write* capabilities — comment, commit
 * status, and label — so `@harness/writeback` resolves a `WriteBackIntent` to a
 * host's tool the same way the read path does. Write tool names are per-host
 * placeholders (corrected against a real server by editing one row, never the
 * service).
 */

import { GitProviderType } from '@harness/domain';

import { GitProviderError } from './git-provider.js';

/** A host this package can route to (the MCP server names in `mcp.config.json`). */
export type GitHost = GitProviderType;

/** The read + write capabilities this package maps, per host. */
export interface ResolvedGitTools {
  readonly getPrTool: string;
  readonly getFilesTool: string;
  readonly commentTool: string;
  readonly statusTool: string;
  readonly labelTool: string;
}

/** One host's row: its public domains, its tool names, and its arg shapes. */
export interface GitToolMapEntry {
  readonly host: GitHost;
  /** Public domains that route to this host (e.g. `github.com`). */
  readonly domains: readonly string[];
  readonly getPrTool: string;
  readonly getFilesTool: string;
  readonly commentTool: string;
  readonly statusTool: string;
  readonly labelTool: string;
  /** Translate `host/owner/name` + PR number into that host's read-tool arguments. */
  readonly buildArgs: (input: { owner: string; name: string; number: number }) => Record<string, unknown>;
  /** Build the comment-tool arguments. */
  readonly buildCommentArgs: (input: {
    owner: string;
    name: string;
    number: number;
    body: string;
  }) => Record<string, unknown>;
  /** Build the status-tool arguments. */
  readonly buildStatusArgs: (input: {
    owner: string;
    name: string;
    number: number;
    state: 'pending' | 'success' | 'failure';
    description: string;
  }) => Record<string, unknown>;
  /** Build the label-tool arguments. */
  readonly buildLabelArgs: (input: {
    owner: string;
    name: string;
    number: number;
    label: string;
  }) => Record<string, unknown>;
}

/**
 * The per-host tool-name/arg-encoding table behind {@link MCPGitProvider} and
 * `@harness/writeback`.
 *
 * Exposed as an interface so a test can inject a single-row table without the
 * real domains; `StaticGitToolMap` is the production default.
 */
export interface GitToolMap {
  /** Map a repo-slug host (e.g. `github.com`) to a host, or `undefined` if unknown. */
  resolveHost(domain: string): GitHost | undefined;
  /** The tool names for a host (throws if the host has no entry). */
  resolve(host: GitHost): ResolvedGitTools;
  /** The argument object for a host's read tools (throws if the host has no entry). */
  buildArgs(host: GitHost, input: { owner: string; name: string; number: number }): Record<string, unknown>;
  /** The argument object for the host's comment tool. */
  buildCommentArgs(
    host: GitHost,
    input: { owner: string; name: string; number: number; body: string },
  ): Record<string, unknown>;
  /** The argument object for the host's status tool. */
  buildStatusArgs(
    host: GitHost,
    input: {
      owner: string;
      name: string;
      number: number;
      state: 'pending' | 'success' | 'failure';
      description: string;
    },
  ): Record<string, unknown>;
  /** The argument object for the host's label tool. */
  buildLabelArgs(
    host: GitHost,
    input: { owner: string; name: string; number: number; label: string },
  ): Record<string, unknown>;
}

/** The built-in rows for the three public Git forges. */
export const DEFAULT_GIT_TOOL_MAP: readonly GitToolMapEntry[] = [
  {
    host: GitProviderType.GitHub,
    domains: ['github.com', 'www.github.com'],
    getPrTool: 'get_pull_request',
    getFilesTool: 'list_pull_request_files',
    // Tool names match the `github-mcp-server-js` server (mcp.config.json).
    // This server's comment/label tools operate on an issue number and cannot
    // set commit statuses (no status tool exists).
    commentTool: 'add_comment',
    statusTool: 'set_pr_status',
    labelTool: 'add_labels',
    buildArgs: ({ owner, name, number }) => ({ owner, repo: name, pull_number: number }),
    buildCommentArgs: ({ owner, name, number, body }) => ({
      owner,
      repo: name,
      issue_number: number,
      body,
    }),
    buildStatusArgs: ({ owner, name, number, state, description }) => ({
      owner,
      repo: name,
      issue_number: number,
      state,
      description,
    }),
    buildLabelArgs: ({ owner, name, number, label }) => ({
      owner,
      repo: name,
      issue_number: number,
      labels: [label],
    }),
  },
  {
    host: GitProviderType.GitLab,
    domains: ['gitlab.com', 'www.gitlab.com'],
    getPrTool: 'get_merge_request',
    getFilesTool: 'list_merge_request_diffs',
    commentTool: 'create_mr_note',
    statusTool: 'set_mr_status',
    labelTool: 'add_mr_labels',
    buildArgs: ({ owner, name, number }) => ({
      project: `${owner}/${name}`,
      merge_request_iid: number,
    }),
    buildCommentArgs: ({ owner, name, number, body }) => ({
      project: `${owner}/${name}`,
      merge_request_iid: number,
      body,
    }),
    buildStatusArgs: ({ owner, name, number, state, description }) => ({
      project: `${owner}/${name}`,
      merge_request_iid: number,
      state,
      description,
    }),
    buildLabelArgs: ({ owner, name, number, label }) => ({
      project: `${owner}/${name}`,
      merge_request_iid: number,
      label,
    }),
  },
  {
    host: GitProviderType.Bitbucket,
    domains: ['bitbucket.org', 'www.bitbucket.org'],
    getPrTool: 'get_pullrequest',
    getFilesTool: 'list_pullrequest_files',
    commentTool: 'add_pr_comment',
    statusTool: 'set_pr_status',
    labelTool: 'add_pr_labels',
    buildArgs: ({ owner, name, number }) => ({
      workspace: owner,
      repo_slug: name,
      pull_request_id: number,
    }),
    buildCommentArgs: ({ owner, name, number, body }) => ({
      workspace: owner,
      repo_slug: name,
      pull_request_id: number,
      body,
    }),
    buildStatusArgs: ({ owner, name, number, state, description }) => ({
      workspace: owner,
      repo_slug: name,
      pull_request_id: number,
      state,
      description,
    }),
    buildLabelArgs: ({ owner, name, number, label }) => ({
      workspace: owner,
      repo_slug: name,
      pull_request_id: number,
      label,
    }),
  },
];

/** The production {@link GitToolMap} over {@link DEFAULT_GIT_TOOL_MAP}. */
export class StaticGitToolMap implements GitToolMap {
  private readonly byHost = new Map<GitHost, GitToolMapEntry>();
  private readonly byDomain = new Map<string, GitHost>();

  constructor(entries: readonly GitToolMapEntry[] = DEFAULT_GIT_TOOL_MAP) {
    for (const entry of entries) {
      this.byHost.set(entry.host, entry);
      for (const domain of entry.domains) {
        this.byDomain.set(domain, entry.host);
      }
    }
  }

  resolveHost(domain: string): GitHost | undefined {
    return this.byDomain.get(domain);
  }

  resolve(host: GitHost): ResolvedGitTools {
    const entry = this.require(host);
    return {
      getPrTool: entry.getPrTool,
      getFilesTool: entry.getFilesTool,
      commentTool: entry.commentTool,
      statusTool: entry.statusTool,
      labelTool: entry.labelTool,
    };
  }

  buildArgs(host: GitHost, input: { owner: string; name: string; number: number }): Record<string, unknown> {
    return this.require(host).buildArgs(input);
  }

  buildCommentArgs(
    host: GitHost,
    input: { owner: string; name: string; number: number; body: string },
  ): Record<string, unknown> {
    return this.require(host).buildCommentArgs(input);
  }

  buildStatusArgs(
    host: GitHost,
    input: {
      owner: string;
      name: string;
      number: number;
      state: 'pending' | 'success' | 'failure';
      description: string;
    },
  ): Record<string, unknown> {
    return this.require(host).buildStatusArgs(input);
  }

  buildLabelArgs(
    host: GitHost,
    input: { owner: string; name: string; number: number; label: string },
  ): Record<string, unknown> {
    return this.require(host).buildLabelArgs(input);
  }

  private require(host: GitHost): GitToolMapEntry {
    const entry = this.byHost.get(host);
    if (entry === undefined) {
      throw new GitProviderError(`no Git tool map entry for host "${host}"`);
    }
    return entry;
  }
}
