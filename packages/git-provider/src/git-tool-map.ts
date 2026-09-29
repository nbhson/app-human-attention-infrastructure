/**
 * `GitToolMap` — the capability→tool-name binding that makes "add a Git forge"
 * a single table entry instead of a REST adapter.
 *
 * Different Git MCP servers name the same capability differently
 * (`get_pull_request` vs `get_merge_request` vs `getPullRequest`) and take
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
      project_id: `${owner}/${name}`,
      merge_request_iid: number,
    }),
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
    domains: ['bitbucket.org', 'www.bitbucket.org'],
    // Tool names match @pavel-kalmykov/bitbucket-server-mcp (Server/DC API).
    // get-files tool returns raw unified diff, parsed by unified-diff.ts.
    // Status/label tools don't exist on Server — write-back fails loudly if attempted.
    getPrTool: 'get_pull_request',
    getFilesTool: 'get_diff',
    commentTool: 'manage_comment',
    statusTool: 'set_pr_status',
    labelTool: 'manage_labels',
    buildArgs: ({ owner, name, number }) => ({
      project: owner,
      repository: name,
      prId: number,
    }),
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
    buildLabelArgs: ({ owner, name, label }) => ({
      action: 'add',
      project: owner,
      repository: name,
      name: label,
    }),
  },
];

/** Options for {@link StaticGitToolMap} beyond the built-in public-forge rows. */
export interface StaticGitToolMapOptions {
  /**
   * Extra domains that route to the Bitbucket row — Bitbucket Server / Data
   * Center instances (e.g. `git.company.com`) whose host contains no
   * "bitbucket" keyword. Prefer {@link StaticGitToolMap.fromEnv} so these come
   * from `BITBUCKET_DOMAINS` / `BITBUCKET_URL` instead of code.
   */
  readonly extraBitbucketDomains?: readonly string[];
}

/**
 * Read the Bitbucket Server / Data Center domains out of the environment.
 *
 * - `BITBUCKET_DOMAINS`: comma-separated host list
 *   (e.g. `git.company.com,bb.internal`).
 * - `BITBUCKET_URL` / `BITBUCKET_BASE_URL`: the instance base URL
 *   (e.g. `https://git.company.com`) — its host is routed to Bitbucket, and
 *   the value is inherited by the `bitbucket` MCP subprocess for its own API
 *   calls (see `packages/mcp/src/transport.ts`).
 */
export function bitbucketDomainsFromEnv(env: Record<string, string | undefined> = process.env): readonly string[] {
  const domains = new Set<string>();
  const list = env['BITBUCKET_DOMAINS'];
  if (list !== undefined) {
    for (const part of list.split(',')) {
      const domain = part
        .trim()
        .toLowerCase()
        .replace(/^www\./, '');
      if (domain.length > 0) {
        domains.add(domain);
      }
    }
  }
  for (const key of ['BITBUCKET_URL', 'BITBUCKET_BASE_URL'] as const) {
    const raw = env[key];
    if (raw === undefined || raw.length === 0) {
      continue;
    }
    try {
      domains.add(new URL(raw).host.toLowerCase().replace(/^www\./, ''));
    } catch {
      // An unparseable base URL is the operator's typo — ignore it here rather
      // than crashing the whole tool map; the MCP call will fail loudly later.
    }
  }
  return [...domains];
}

/** The production {@link GitToolMap} over {@link DEFAULT_GIT_TOOL_MAP}. */
export class StaticGitToolMap implements GitToolMap {
  private readonly byHost = new Map<GitHost, GitToolMapEntry>();
  private readonly byDomain = new Map<string, GitHost>();

  constructor(entries: readonly GitToolMapEntry[] = DEFAULT_GIT_TOOL_MAP, opts: StaticGitToolMapOptions = {}) {
    for (const entry of entries) {
      this.byHost.set(entry.host, entry);
      for (const domain of entry.domains) {
        this.byDomain.set(domain, entry.host);
      }
    }
    for (const domain of opts.extraBitbucketDomains ?? []) {
      this.byDomain.set(domain, GitProviderType.Bitbucket);
    }
  }

  /**
   * Build the production map with Bitbucket Server / Data Center domains read
   * from the environment (`BITBUCKET_DOMAINS` / `BITBUCKET_URL`). Prefer this
   * over the bare constructor at every runtime call site so a self-hosted
   * Bitbucket instance routes to the Bitbucket row without a code change.
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): StaticGitToolMap {
    return new StaticGitToolMap(DEFAULT_GIT_TOOL_MAP, {
      extraBitbucketDomains: bitbucketDomainsFromEnv(env),
    });
  }

  resolveHost(domain: string): GitHost | undefined {
    const direct = this.byDomain.get(domain);
    if (direct !== undefined) return direct;
    // Self-hosted GitLab fallback: any domain containing "gitlab" (e.g.
    // gitlab.kidsplaza.org, gitlab.example.com) routes to the GitLab tool map
    // so a self-hosted MR URL like
    // https://gitlab.kidsplaza.org/dwh/web-ui/-/merge_requests/387 can be
    // fetched through the same `gitlab` MCP server.
    if (domain.includes('gitlab')) return GitProviderType.GitLab;
    // Same idea for Bitbucket: bitbucket.company.com and friends route to the
    // Bitbucket row. Hosts without the keyword (e.g. git.company.com) need an
    // explicit `BITBUCKET_DOMAINS` / `BITBUCKET_URL` entry (see `fromEnv`).
    if (domain.includes('bitbucket')) return GitProviderType.Bitbucket;
    return undefined;
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
