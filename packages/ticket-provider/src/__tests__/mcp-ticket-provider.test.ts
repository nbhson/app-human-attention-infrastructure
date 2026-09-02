import { describe, expect, it } from 'vitest';

import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { McpConfigError } from '@harness/mcp';

import { TicketProviderError } from '../ticket-provider.js';
import { MCPTicketProvider, UnknownTicketSystemError } from '../mcp-ticket-provider.js';
import { StaticTicketToolMap } from '../ticket-tool-map.js';

function textResult(json: unknown, isError = false): ToolResult {
  return { isError, content: [{ type: 'text', text: JSON.stringify(json) }] };
}

function textError(message: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

const ISSUE_JSON = {
  key: 'ACME-42',
  fields: { summary: 'Fix the thing', issuetype: { name: 'Bug' } },
};

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

/** A registry that only knows about configured server names. */
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

const OK = { isError: false, content: [{ type: 'text', text: '{}' }] } as ToolResult;

function jiraRegistry(overrides: { issue?: ToolResult; comment?: ToolResult; transition?: ToolResult } = {}): {
  registry: FakeRegistry;
  client: FakeMcpClient;
} {
  const client = new FakeMcpClient(
    new Map([
      ['get_issue', overrides.issue ?? textResult(ISSUE_JSON)],
      ['add_comment', overrides.comment ?? OK],
      ['transition_issue', overrides.transition ?? OK],
    ]),
  );
  return { registry: new FakeRegistry(new Map([['jira', client]])), client };
}

function jiraProvider(registry: McpServerRegistry): MCPTicketProvider {
  return new MCPTicketProvider(registry, new StaticTicketToolMap(), 'https://acme.atlassian.net');
}

describe('MCPTicketProvider', () => {
  it('routes the jira system to its client and maps to Issue', async () => {
    const { registry } = jiraRegistry();
    const issue = await jiraProvider(registry).fetchIssue({ key: 'ACME-42' });

    expect(issue.provider).toBe('jira');
    expect(issue.key).toBe('ACME-42');
    expect(issue.summary).toBe('Fix the thing');
    expect(issue.url).toBe('https://acme.atlassian.net/browse/ACME-42');
  });

  it('calls the mapped tool with args parsed from the issue key', async () => {
    const { registry, client } = jiraRegistry();
    await jiraProvider(registry).fetchIssue({ key: 'ACME-42' });

    expect(client.calls).toEqual([{ tool: 'get_issue', args: { issue_id_or_key: 'ACME-42' } }]);
  });

  it('posts a comment through the mapped comment tool', async () => {
    const { registry, client } = jiraRegistry();
    await jiraProvider(registry).postComment({ key: 'ACME-42' }, 'looks good');

    expect(client.calls).toEqual([{ tool: 'add_comment', args: { issue_id_or_key: 'ACME-42', body: 'looks good' } }]);
  });

  it('transitions through the mapped transition tool by target status', async () => {
    const { registry, client } = jiraRegistry();
    await jiraProvider(registry).transition({ key: 'ACME-42' }, 'In Review');

    expect(client.calls).toEqual([
      {
        tool: 'transition_issue',
        args: { issue_id_or_key: 'ACME-42', target_status: 'In Review' },
      },
    ]);
  });

  it('throws UnknownTicketSystemError when the system has no config entry', async () => {
    const registry = new FakeRegistry(new Map([['github', new FakeMcpClient(new Map())]]));
    await expect(jiraProvider(registry).fetchIssue({ key: 'ACME-42' })).rejects.toBeInstanceOf(
      UnknownTicketSystemError,
    );
  });

  it('surfaces a tool error as TicketProviderError, not a raw throw', async () => {
    const { registry } = jiraRegistry({ issue: { isError: true, content: [] } });
    await expect(jiraProvider(registry).fetchIssue({ key: 'ACME-42' })).rejects.toBeInstanceOf(TicketProviderError);
  });

  it('surfaces a comment tool error as TicketProviderError', async () => {
    const { registry } = jiraRegistry({ comment: textError('boom') });
    await expect(jiraProvider(registry).postComment({ key: 'ACME-42' }, 'hi')).rejects.toBeInstanceOf(
      TicketProviderError,
    );
  });

  it('lists available statuses when a transition fails with a no-such-status payload', async () => {
    const { registry } = jiraRegistry({
      transition: textError(JSON.stringify({ statuses: ['To Do', 'In Review', 'Done'] })),
    });
    await expect(jiraProvider(registry).transition({ key: 'ACME-42' }, 'Nope')).rejects.toThrow(
      /available statuses: To Do, In Review, Done/,
    );
  });
});
