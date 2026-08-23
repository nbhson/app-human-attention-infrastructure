/**
 * Multi-provider concurrency (Phase 3 day-36 §3.3) — the proof that two reviews
 * against two different hosts resolve *their own* configs with zero
 * cross-contamination.
 *
 * The provider seam carries no token: tokens are injected by the
 * {@link McpServerRegistry} at connect time (per-`tokenEnv`, per host). So the
 * isolation that matters at this boundary is *routing* — an interleaved GitHub
 * review and GitLab review must each reach only their own registry entry, their
 * own tool names, and their own argument shapes, and must never invoke the other
 * host's client. The tests assert **which** host a request hit (and, crucially,
 * which host it did *not*), not merely that it succeeded (day-36 §2.3, §6).
 */

import { describe, expect, it } from 'vitest';

import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { McpConfigError } from '@harness/mcp';
import { GitProviderType } from '@harness/domain';

import { MCPGitProvider } from '../mcp-git-provider.js';
import { StaticGitToolMap } from '../git-tool-map.js';

function textResult(json: unknown): ToolResult {
  return { isError: false, content: [{ type: 'text', text: JSON.stringify(json) }] };
}

function prJson(number: number, title: string): unknown {
  return {
    number,
    title,
    author: 'alice',
    head: { ref: 'feature', sha: `head-${number}` },
    base: { ref: 'main', sha: 'base-1' },
    url: `https://example.com/acme/api/pull/${number}`,
  };
}

/** A client that answers only its own host's tool names from a name→result table. */
class FakeMcpClient implements McpClient {
  readonly calls: Array<{ tool: string; args: Record<string, unknown> }> = [];

  constructor(private readonly responses: ReadonlyMap<string, ToolResult>) {}

  initialize(): Promise<{ name: string; version: string }> {
    return Promise.resolve({ name: 'fake', version: '0.0.0' });
  }

  listTools(): Promise<never> {
    throw new Error('listTools not used in the fetch path');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ tool: name, args });
    const result = this.responses.get(name);
    if (!result) {
      // The cross-contamination tripwire: a client asked a tool it does not own.
      throw new Error(`host client received an out-of-scope tool call: ${name}`);
    }
    return result;
  }

  close(): Promise<void> {}
}

/** A registry that hands out one client per host and records every lookup. */
class RecordingRegistry implements McpServerRegistry {
  readonly getRequests: string[] = [];

  constructor(private readonly clients: ReadonlyMap<string, McpClient>) {}

  async get(name: string): Promise<McpClient> {
    this.getRequests.push(name);
    const client = this.clients.get(name);
    if (!client) {
      throw new McpConfigError(`no MCP server configured for "${name}"`);
    }
    return client;
  }

  entries(): [] {
    return [];
  }

  list(): string[] {
    return [...this.clients.keys()];
  }

  closeAll(): Promise<void> {}
}

function githubClient(number: number, title: string): FakeMcpClient {
  return new FakeMcpClient(
    new Map([
      ['get_pull_request', textResult(prJson(number, title))],
      [
        'list_pull_request_files',
        textResult([{ path: 'a.ts', status: 'modified', additions: 1, deletions: 0 }]),
      ],
    ]),
  );
}

function gitlabClient(number: number, title: string): FakeMcpClient {
  return new FakeMcpClient(
    new Map([
      ['get_merge_request', textResult(prJson(number, title))],
      [
        'list_merge_request_diffs',
        textResult([{ path: 'b.ts', status: 'modified', additions: 2, deletions: 1 }]),
      ],
    ]),
  );
}

describe('multi-provider concurrency (day-36)', () => {
  it('interleaved GitHub + GitLab reviews resolve their own clients with no cross-talk', async () => {
    const github = githubClient(42, 'GitHub PR only');
    const gitlab = gitlabClient(7, 'GitLab MR only');
    const registry = new RecordingRegistry(
      new Map([
        ['github', github],
        ['gitlab', gitlab],
      ]),
    );
    const provider = new MCPGitProvider(registry, new StaticGitToolMap());

    // Two reviews run concurrently against two different hosts.
    const [gh, gl] = await Promise.all([
      provider.fetchPullRequest({ repo: 'github.com/acme/api', number: 42 }),
      provider.fetchPullRequest({ repo: 'gitlab.com/acme/api', number: 7 }),
    ]);

    // Each review mapped to its own host, its own payload, its own files.
    expect(gh.provider).toBe(GitProviderType.GitHub);
    expect(gh.number).toBe(42);
    expect(gh.title).toBe('GitHub PR only');
    expect(gl.provider).toBe(GitProviderType.GitLab);
    expect(gl.number).toBe(7);
    expect(gl.title).toBe('GitLab MR only');

    // Each host resolved its own registry entry, exactly once.
    expect(registry.getRequests.sort()).toEqual(['github', 'gitlab']);

    // The tripwire: neither client was ever asked a tool it does not own. A
    // "wrong token used" bug would surface here as an out-of-scope tool name.
    expect(github.calls.map((c) => c.tool).sort()).toEqual([
      'get_pull_request',
      'list_pull_request_files',
    ]);
    expect(gitlab.calls.map((c) => c.tool).sort()).toEqual([
      'get_merge_request',
      'list_merge_request_diffs',
    ]);
    // And the argument shapes stayed host-local (pull_number vs merge_request_iid).
    expect(github.calls[0]?.args).toEqual({ owner: 'acme', repo: 'api', pull_number: 42 });
    expect(gitlab.calls[0]?.args).toEqual({
      project: 'acme/api',
      merge_request_iid: 7,
    });
  });

  it('a scoped tool map routes each domain to only its own host (config isolation)', async () => {
    const map = new StaticGitToolMap();
    expect(map.resolveHost('github.com')).toBe(GitProviderType.GitHub);
    expect(map.resolveHost('gitlab.com')).toBe(GitProviderType.GitLab);
    expect(map.resolveHost('bitbucket.org')).toBe(GitProviderType.Bitbucket);
    // A domain is never routed to another host's row.
    expect(map.resolveHost('github.com')).not.toBe(GitProviderType.GitLab);
  });

  it('a host absent from the registry fails loudly rather than borrowing another host', async () => {
    // Only GitHub is configured; a GitLab repo must not silently ride GitHub.
    const registry = new RecordingRegistry(new Map([['github', githubClient(1, 'x')]]));
    const provider = new MCPGitProvider(registry, new StaticGitToolMap());

    await expect(
      provider.fetchPullRequest({ repo: 'gitlab.com/acme/api', number: 1 }),
    ).rejects.toThrow(/no Git MCP provider|no MCP server configured/);
    // The failed lookup asked for *gitlab* (its own, missing host) — it never
    // fell through to the configured github client.
    expect(registry.getRequests).toEqual(['gitlab']);
  });
});
