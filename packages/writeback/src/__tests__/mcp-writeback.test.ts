import { describe, expect, it } from 'vitest';

import { GitProviderType, TicketProviderType, WritebackAction } from '@harness/domain';
import type { WriteBackIntent } from '@harness/domain';
import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { StaticGitToolMap } from '@harness/git-provider';
import { StaticTicketToolMap } from '@harness/ticket-provider';

import { MCPWriteBack } from '../mcp-writeback.js';
import { WriteBackError } from '../writeback-service.js';

// --- Compile-time guard (day-06 §2.2) --------------------------------------
// `WriteBackIntent` must not grow a code/commit/diff slot. Adding one makes the
// corresponding constant's type `never`, which fails `typecheck` — the intent
// type is the "never-write-code" guardrail (the plan's §6 pitfall). Exported so
// they read as "used" and are never elided.

type AssertKeyAbsent<K extends string> = K extends keyof WriteBackIntent ? never : true;
export const noCodeSlot: AssertKeyAbsent<'code'> = true;
export const noCommitSlot: AssertKeyAbsent<'commit'> = true;
export const noDiffSlot: AssertKeyAbsent<'diff'> = true;

/** A fake client that records every `callTool(name, args)` and returns a fixed result. */
class FakeMcpClient implements McpClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(private readonly result: ToolResult = { isError: false, content: [] }) {}

  initialize() {
    return Promise.resolve({ name: 'fake', version: '0.0.0' });
  }

  listTools() {
    return Promise.resolve([]);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    return this.result;
  }

  close() {
    return Promise.resolve();
  }
}

/** A registry that hands out one fake client and records which names were asked for. */
function fakeRegistry(client: McpClient): McpServerRegistry & { gets: string[] } {
  const gets: string[] = [];
  return {
    gets,
    get: async (name: string) => {
      gets.push(name);
      return client;
    },
    entries: () => [],
    list: () => [],
    closeAll: async () => {},
  };
}

function gitIntent(
  overrides: Partial<WriteBackIntent> & Pick<WriteBackIntent, 'action'>,
): WriteBackIntent {
  return {
    id: 'wb-git',
    provider: GitProviderType.GitHub,
    externalId: '42',
    repo: 'github.com/acme/api',
    ...overrides,
  } satisfies WriteBackIntent;
}

function ticketIntent(
  overrides: Partial<WriteBackIntent> & Pick<WriteBackIntent, 'action'>,
): WriteBackIntent {
  return {
    id: 'wb-jira',
    provider: TicketProviderType.Jira,
    externalId: 'ACME-42',
    ...overrides,
  } satisfies WriteBackIntent;
}

function build(
  enabled: (provider: unknown) => boolean,
  client: FakeMcpClient = new FakeMcpClient(),
) {
  const registry = fakeRegistry(client);
  const service = new MCPWriteBack(registry, new StaticGitToolMap(), new StaticTicketToolMap(), {
    enabled,
  });
  return { service, client, registry };
}

describe('MCPWriteBack', () => {
  it('enabled=false is a successful no-op — zero tool calls, zero provider lookups', async () => {
    const { service, client, registry } = build(() => false);

    const result = await service.write(gitIntent({ action: WritebackAction.Comment }));

    expect(result).toEqual({ ok: true, intentId: 'wb-git' });
    expect(client.calls).toEqual([]);
    expect(registry.gets).toEqual([]);
  });

  it('maps git COMMENT/STATUS/LABEL to the per-host write tools', async () => {
    const { service, client, registry } = build(() => true);

    await service.write(gitIntent({ action: WritebackAction.Comment, body: 'LGTM' }));
    await service.write(
      gitIntent({ action: WritebackAction.Status, state: 'success', body: 'verified' }),
    );
    await service.write(gitIntent({ action: WritebackAction.Label, label: 'approved' }));

    expect(registry.gets).toEqual(['github', 'github', 'github']);
    expect(client.calls.map((c) => c.name)).toEqual([
      'add_pr_comment',
      'set_pr_status',
      'add_pr_labels',
    ]);
    expect(client.calls[0]?.args).toEqual({
      owner: 'acme',
      repo: 'api',
      pull_number: 42,
      body: 'LGTM',
    });
    expect(client.calls[1]?.args).toEqual({
      owner: 'acme',
      repo: 'api',
      pull_number: 42,
      state: 'success',
      description: 'verified',
    });
    expect(client.calls[2]?.args).toEqual({
      owner: 'acme',
      repo: 'api',
      pull_number: 42,
      label: 'approved',
    });
  });

  it('git hosts reject TRANSITION with WriteBackError', async () => {
    const { service, client } = build(() => true);

    await expect(
      service.write(gitIntent({ action: WritebackAction.Transition, toState: 'Merged' })),
    ).rejects.toThrow(WriteBackError);
    expect(client.calls).toEqual([]);
  });

  it('git write-back requires a repo slug', async () => {
    const { service } = build(() => true);

    await expect(
      service.write({
        id: 'wb-norepo',
        provider: GitProviderType.GitHub,
        externalId: '42',
        action: WritebackAction.Comment,
      }),
    ).rejects.toThrow(/requires a "repo"/);
  });

  it('maps Jira COMMENT/TRANSITION to the ticket write tools', async () => {
    const { service, client, registry } = build(() => true);

    await service.write(ticketIntent({ action: WritebackAction.Comment, body: 'under review' }));
    await service.write(ticketIntent({ action: WritebackAction.Transition, toState: 'In Review' }));

    expect(registry.gets).toEqual(['jira', 'jira']);
    expect(client.calls.map((c) => c.name)).toEqual(['add_comment', 'transition_issue']);
    expect(client.calls[0]?.args).toEqual({ issue_id_or_key: 'ACME-42', body: 'under review' });
    expect(client.calls[1]?.args).toEqual({
      issue_id_or_key: 'ACME-42',
      target_status: 'In Review',
    });
  });

  it('Jira rejects STATUS/LABEL with WriteBackError', async () => {
    const { service, client } = build(() => true);

    await expect(
      service.write(ticketIntent({ action: WritebackAction.Status, state: 'success' })),
    ).rejects.toThrow(WriteBackError);
    await expect(
      service.write(ticketIntent({ action: WritebackAction.Label, label: 'approved' })),
    ).rejects.toThrow(WriteBackError);
    expect(client.calls).toEqual([]);
  });

  it('a failing tool result returns ok:false with the error, not a throw', async () => {
    const client = new FakeMcpClient({
      isError: true,
      content: [{ type: 'text', text: 'nope' }],
    });
    const { service } = build(() => true, client);

    const result = await service.write(gitIntent({ action: WritebackAction.Comment, body: 'x' }));

    expect(result).toEqual({ ok: false, intentId: 'wb-git', error: 'git comment failed: nope' });
  });

  it('reflects a JSON id/comment response as externalRef', async () => {
    const client = new FakeMcpClient({
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ id: 'comment-99' }) }],
    });
    const { service } = build(() => true, client);

    const result = await service.write(gitIntent({ action: WritebackAction.Comment, body: 'x' }));

    expect(result).toEqual({ ok: true, intentId: 'wb-git', externalRef: 'comment-99' });
  });

  it('maps GitLab COMMENT/STATUS/LABEL to GitLab write tools', async () => {
    const { service, client, registry } = build(() => true);

    await service.write(
      gitIntent({
        action: WritebackAction.Comment,
        provider: GitProviderType.GitLab,
        repo: 'gitlab.com/acme/api',
        externalId: '7',
        body: 'needs work',
      }),
    );
    await service.write(
      gitIntent({
        action: WritebackAction.Status,
        provider: GitProviderType.GitLab,
        repo: 'gitlab.com/acme/api',
        externalId: '7',
        state: 'failure',
        body: 'tests fail',
      }),
    );
    await service.write(
      gitIntent({
        action: WritebackAction.Label,
        provider: GitProviderType.GitLab,
        repo: 'gitlab.com/acme/api',
        externalId: '7',
        label: 'needs-changes',
      }),
    );

    expect(registry.gets).toEqual(['gitlab', 'gitlab', 'gitlab']);
    expect(client.calls.map((c) => c.name)).toEqual([
      'create_mr_note',
      'set_mr_status',
      'add_mr_labels',
    ]);
    expect(client.calls[0]?.args).toEqual({
      project: 'acme/api',
      merge_request_iid: 7,
      body: 'needs work',
    });
    expect(client.calls[1]?.args).toEqual({
      project: 'acme/api',
      merge_request_iid: 7,
      state: 'failure',
      description: 'tests fail',
    });
    expect(client.calls[2]?.args).toEqual({
      project: 'acme/api',
      merge_request_iid: 7,
      label: 'needs-changes',
    });
  });

  it('maps Bitbucket COMMENT/STATUS/LABEL to Bitbucket write tools', async () => {
    const { service, client, registry } = build(() => true);

    await service.write(
      gitIntent({
        action: WritebackAction.Comment,
        provider: GitProviderType.Bitbucket,
        repo: 'bitbucket.org/acme/api',
        externalId: '3',
        body: 'ship it',
      }),
    );
    await service.write(
      gitIntent({
        action: WritebackAction.Status,
        provider: GitProviderType.Bitbucket,
        repo: 'bitbucket.org/acme/api',
        externalId: '3',
        state: 'success',
        body: 'verified',
      }),
    );
    await service.write(
      gitIntent({
        action: WritebackAction.Label,
        provider: GitProviderType.Bitbucket,
        repo: 'bitbucket.org/acme/api',
        externalId: '3',
        label: 'rfc',
      }),
    );

    expect(registry.gets).toEqual(['bitbucket', 'bitbucket', 'bitbucket']);
    expect(client.calls.map((c) => c.name)).toEqual([
      'add_pr_comment',
      'set_pr_status',
      'add_pr_labels',
    ]);
    expect(client.calls[0]?.args).toEqual({
      workspace: 'acme',
      repo_slug: 'api',
      pull_request_id: 3,
      body: 'ship it',
    });
  });

  it('git TRANSITION carries structured target identity on the WriteBackError', async () => {
    const { service } = build(() => true);

    let caught: unknown;
    try {
      await service.write(gitIntent({ action: WritebackAction.Transition, toState: 'Merged' }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WriteBackError);
    const error = caught as WriteBackError;
    expect(error.provider).toBe(GitProviderType.GitHub);
    expect(error.action).toBe(WritebackAction.Transition);
    expect(error.externalId).toBe('42');
  });
});
