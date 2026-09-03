import { describe, expect, it } from 'vitest';

import { GitProviderType, TicketProviderType, WritebackAction } from '@harness/domain';
import type { WriteBackIntent, WritebackClaim, WritebackFinalize, WritebackLogStore } from '@harness/domain';
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

/** A client whose `callTool` rejects — models a transport/host failure (day-08 §2.3). */
class ThrowingMcpClient extends FakeMcpClient {
  constructor(private readonly error: Error) {
    super({ isError: false, content: [] });
  }

  override async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    throw this.error;
  }
}

/** An in-memory audit store mirroring the Drizzle store's claim/finalize semantics. */
class FakeWritebackLogStore implements WritebackLogStore {
  readonly rows: Array<{
    intentId: string;
    dedupKey: string;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DUPLICATE';
    decisionId?: string;
    error?: string;
  }> = [];

  async claim(input: WritebackClaim): Promise<'claimed' | 'duplicate'> {
    const duplicate = this.rows.some((row) => row.dedupKey === input.dedupKey && row.status === 'SUCCEEDED');
    this.rows.push({
      intentId: input.intentId,
      dedupKey: input.dedupKey,
      status: duplicate ? 'DUPLICATE' : 'PENDING',
      ...(input.decisionId === undefined ? {} : { decisionId: input.decisionId }),
    });
    return duplicate ? 'duplicate' : 'claimed';
  }

  async finalize(input: WritebackFinalize): Promise<void> {
    const row = this.rows.find((r) => r.intentId === input.intentId);
    if (row) {
      row.status = input.status;
      if (input.error !== undefined) {
        row.error = input.error;
      }
    }
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

function gitIntent(overrides: Partial<WriteBackIntent> & Pick<WriteBackIntent, 'action'>): WriteBackIntent {
  return {
    id: 'wb-git',
    provider: GitProviderType.GitHub,
    externalId: '42',
    repo: 'github.com/acme/api',
    ...overrides,
  } satisfies WriteBackIntent;
}

function ticketIntent(overrides: Partial<WriteBackIntent> & Pick<WriteBackIntent, 'action'>): WriteBackIntent {
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
  store: FakeWritebackLogStore = new FakeWritebackLogStore(),
) {
  const registry = fakeRegistry(client);
  const service = new MCPWriteBack(registry, new StaticGitToolMap(), new StaticTicketToolMap(), store, {
    enabled,
  });
  return { service, client, registry, store };
}

describe('MCPWriteBack', () => {
  it('enabled=false is a successful no-op — zero tool calls, zero provider lookups, zero audit rows', async () => {
    const { service, client, registry, store } = build(() => false);

    const result = await service.write(gitIntent({ action: WritebackAction.Comment }));

    expect(result).toEqual({ ok: true, intentId: 'wb-git' });
    expect(client.calls).toEqual([]);
    expect(registry.gets).toEqual([]);
    expect(store.rows).toEqual([]);
  });

  it('maps git COMMENT/STATUS/LABEL to the per-host write tools', async () => {
    const { service, client, registry } = build(() => true);

    await service.write(gitIntent({ action: WritebackAction.Comment, body: 'LGTM' }));
    await service.write(gitIntent({ action: WritebackAction.Status, state: 'success', body: 'verified' }));
    await service.write(gitIntent({ action: WritebackAction.Label, label: 'approved' }));

    expect(registry.gets).toEqual(['github', 'github', 'github']);
    expect(client.calls.map((c) => c.name)).toEqual(['add_comment', 'set_pr_status', 'add_labels']);
    expect(client.calls[0]?.args).toEqual({
      owner: 'acme',
      repo: 'api',
      issue_number: 42,
      body: 'LGTM',
    });
    expect(client.calls[1]?.args).toEqual({
      owner: 'acme',
      repo: 'api',
      issue_number: 42,
      state: 'success',
      description: 'verified',
    });
    expect(client.calls[2]?.args).toEqual({
      owner: 'acme',
      repo: 'api',
      issue_number: 42,
      labels: ['approved'],
    });
  });

  it('git hosts reject TRANSITION with WriteBackError', async () => {
    const { service, client } = build(() => true);

    await expect(service.write(gitIntent({ action: WritebackAction.Transition, toState: 'Merged' }))).rejects.toThrow(
      WriteBackError,
    );
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

    await expect(service.write(ticketIntent({ action: WritebackAction.Status, state: 'success' }))).rejects.toThrow(
      WriteBackError,
    );
    await expect(service.write(ticketIntent({ action: WritebackAction.Label, label: 'approved' }))).rejects.toThrow(
      WriteBackError,
    );
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
    expect(client.calls.map((c) => c.name)).toEqual(['create_mr_note', 'set_mr_status', 'add_mr_labels']);
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
    expect(client.calls.map((c) => c.name)).toEqual(['add_pr_comment', 'set_pr_status', 'add_pr_labels']);
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

describe('MCPWriteBack audit + idempotency (day-08)', () => {
  it('a retried identical intent calls the host once and marks the second attempt DUPLICATE', async () => {
    const client = new FakeMcpClient({ isError: false, content: [] });
    const store = new FakeWritebackLogStore();
    const { service } = build(() => true, client, store);

    const first = await service.write(gitIntent({ action: WritebackAction.Comment, body: 'LGTM' }));
    const retry = await service.write({
      ...gitIntent({ action: WritebackAction.Comment, body: 'LGTM' }),
      id: 'wb-git-retry',
    });

    expect(first).toEqual({ ok: true, intentId: 'wb-git' });
    expect(retry).toEqual({ ok: true, intentId: 'wb-git-retry' });
    expect(client.calls).toHaveLength(1);
    expect(store.rows.map((row) => row.status)).toEqual(['SUCCEEDED', 'DUPLICATE']);
  });

  it('an adapter throw records a FAILED row with the secret bytes redacted', async () => {
    const secret = 'ghp_abcexampletoken12345';
    const client = new ThrowingMcpClient(new Error(`Authorization: Bearer ${secret} rejected`));
    const store = new FakeWritebackLogStore();
    const { service } = build(() => true, client, store);

    const result = await service.write(gitIntent({ action: WritebackAction.Comment, body: 'x' }));

    expect(result.ok).toBe(false);
    expect(result.intentId).toBe('wb-git');
    expect(result.error).not.toContain(secret);
    expect(client.calls).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.status).toBe('FAILED');
    expect(store.rows[0]?.error).not.toContain(secret);
  });

  it('a failing tool result records a FAILED row and still resolves ok:false', async () => {
    const client = new FakeMcpClient({ isError: true, content: [{ type: 'text', text: 'nope' }] });
    const store = new FakeWritebackLogStore();
    const { service } = build(() => true, client, store);

    const result = await service.write(gitIntent({ action: WritebackAction.Comment, body: 'x' }));

    expect(result).toEqual({ ok: false, intentId: 'wb-git', error: 'git comment failed: nope' });
    expect(store.rows[0]?.status).toBe('FAILED');
    expect(store.rows[0]?.error).toBe('git comment failed: nope');
  });

  it('invalid intents throw before any audit row is written or any call is made', async () => {
    const client = new FakeMcpClient();
    const store = new FakeWritebackLogStore();
    const { service } = build(() => true, client, store);

    await expect(
      service.write({
        ...gitIntent({ action: WritebackAction.Transition, toState: 'Merged' }),
        id: 'wb-invalid',
      }),
    ).rejects.toThrow(WriteBackError);

    expect(store.rows).toEqual([]);
    expect(client.calls).toEqual([]);
  });

  it('threads the intent decisionId onto the claim (day-09 §3.2)', async () => {
    const client = new FakeMcpClient();
    const store = new FakeWritebackLogStore();
    const { service } = build(() => true, client, store);

    await service.write(gitIntent({ action: WritebackAction.Comment, body: 'LGTM', decisionId: 'dec-42' }));

    expect(store.rows[0]?.decisionId).toBe('dec-42');
  });
});
