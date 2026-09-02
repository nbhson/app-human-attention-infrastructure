import { describe, expect, it } from 'vitest';

import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { McpConfigError } from '@harness/mcp';

import { GitProviderError } from '../git-provider.js';
import { MCPGitProvider, UnknownProviderHostError } from '../mcp-git-provider.js';
import { StaticGitToolMap } from '../git-tool-map.js';

function textResult(json: unknown): ToolResult {
  return { isError: false, content: [{ type: 'text', text: JSON.stringify(json) }] };
}

const PR_JSON = {
  number: 42,
  title: 'Add the thing',
  author: 'alice',
  head: { ref: 'feature', sha: 'h1' },
  base: { ref: 'main', sha: 'b1' },
  url: 'https://github.com/acme/api/pull/42',
};
const FILES_JSON = [{ path: 'a.ts', status: 'modified', additions: 1, deletions: 0 }];

/** Records every tool call and answers from a name→result table. */
class FakeMcpClient implements McpClient {
  readonly calls: { tool: string; args: Record<string, unknown> }[] = [];

  constructor(private readonly responses: Map<string, ToolResult>) {}

  async initialize(): Promise<never> {
    throw new Error('initialize not used in the fetch path');
  }

  async listTools(): Promise<never> {
    throw new Error('listTools not used in the fetch path');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ tool: name, args });
    const result = this.responses.get(name);
    if (!result) {
      throw new Error(`unexpected tool call: ${name}`);
    }
    return result;
  }

  async close(): Promise<void> {}
}

/** A registry that only knows about configured host names. */
class FakeRegistry implements McpServerRegistry {
  constructor(private readonly clients: Map<string, McpClient>) {}

  async get(name: string): Promise<McpClient> {
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

  async closeAll(): Promise<void> {}
}

function githubRegistry(overrides: { pr?: ToolResult; files?: ToolResult } = {}): FakeRegistry {
  const client = new FakeMcpClient(
    new Map([
      ['get_pull_request', overrides.pr ?? textResult(PR_JSON)],
      ['list_pull_request_files', overrides.files ?? textResult(FILES_JSON)],
    ]),
  );
  return new FakeRegistry(new Map([['github', client]]));
}

describe('MCPGitProvider', () => {
  it('routes github.com to the github client and maps to PullRequest', async () => {
    const registry = githubRegistry();
    const provider = new MCPGitProvider(registry, new StaticGitToolMap());
    const pr = await provider.fetchPullRequest({ repo: 'github.com/acme/api', number: 42 });

    expect(pr.provider).toBe('github');
    expect(pr.title).toBe('Add the thing');
    expect(pr.files).toHaveLength(1);
  });

  it('calls the mapped tool names with args parsed from the repo slug', async () => {
    const registry = githubRegistry();
    const provider = new MCPGitProvider(registry, new StaticGitToolMap());
    await provider.fetchPullRequest({ repo: 'github.com/acme/api', number: 42 });

    const client = await registry.get('github');
    expect((client as FakeMcpClient).calls).toEqual([
      { tool: 'get_pull_request', args: { owner: 'acme', repo: 'api', pull_number: 42 } },
      { tool: 'list_pull_request_files', args: { owner: 'acme', repo: 'api', pull_number: 42 } },
    ]);
  });

  it('routes gitlab.com through its distinct tool name + arg shape', async () => {
    const client = new FakeMcpClient(
      new Map([
        ['get_merge_request', textResult(PR_JSON)],
        ['list_merge_request_diffs', textResult(FILES_JSON)],
      ]),
    );
    const registry = new FakeRegistry(new Map([['gitlab', client]]));
    const provider = new MCPGitProvider(registry, new StaticGitToolMap());

    const pr = await provider.fetchPullRequest({
      repo: 'gitlab.com/group/sub/api',
      number: 7,
    });
    expect(pr.provider).toBe('gitlab');
    expect(client.calls[0]).toEqual({
      tool: 'get_merge_request',
      args: { project: 'group/sub/api', merge_request_iid: 7 },
    });
  });

  it('throws UnknownProviderHostError on an un-routable domain', async () => {
    const provider = new MCPGitProvider(githubRegistry(), new StaticGitToolMap());
    await expect(provider.fetchPullRequest({ repo: 'gitea.example/acme/api', number: 1 })).rejects.toBeInstanceOf(
      UnknownProviderHostError,
    );
  });

  it('throws UnknownProviderHostError when the host has no config entry', async () => {
    // `gitlab` is known to the tool map but absent from this registry.
    const registry = new FakeRegistry(new Map([['github', new FakeMcpClient(new Map())]]));
    const provider = new MCPGitProvider(registry, new StaticGitToolMap());
    await expect(provider.fetchPullRequest({ repo: 'gitlab.com/acme/api', number: 1 })).rejects.toBeInstanceOf(
      UnknownProviderHostError,
    );
  });

  it('surfaces a tool error as GitProviderError, not a raw throw', async () => {
    const registry = githubRegistry({
      pr: { isError: true, content: [] },
    });
    const provider = new MCPGitProvider(registry, new StaticGitToolMap());
    await expect(provider.fetchPullRequest({ repo: 'github.com/acme/api', number: 42 })).rejects.toBeInstanceOf(
      GitProviderError,
    );
  });

  it('write primitives fail loudly until Day 06', async () => {
    const provider = new MCPGitProvider(githubRegistry(), new StaticGitToolMap());
    await expect(provider.postComment({ repo: 'github.com/acme/api', number: 1 }, 'hi')).rejects.toBeInstanceOf(
      GitProviderError,
    );
    await expect(
      provider.setStatus({ repo: 'github.com/acme/api', number: 1 }, 'success', 'ok'),
    ).rejects.toBeInstanceOf(GitProviderError);
  });
});
