/**
 * Write-back Week-2 checkpoint demo (Phase 3 day-10 §3.1) — `pnpm demo:writeback`.
 *
 * Replays one APPROVE decision through the full write-back path across the whole
 * provider matrix — GitHub, GitLab, Bitbucket (COMMENT + STATUS) and Jira
 * (COMMENT + TRANSITION) — against an in-memory fake MCP client, then proves the
 * three safety properties the week existed to establish:
 *
 *   1. **ON → the write lands.** Each provider records `SUCCEEDED` audit rows and
 *      the mapped tool calls, with the host handle recovered as `externalRef`.
 *   2. **OFF → provably nothing external.** The three-layer toggle (request flag
 *      ∧ global `WRITEBACK_ENABLED` ceiling, then the per-provider
 *      `WRITEBACK_<PROVIDER>` arming) leaves zero tool calls and zero audit rows
 *      when any layer is disarmed.
 *   3. **Idempotent + redacted.** A retried decision is a `DUPLICATE` (one
 *      external write, never two), and a forced 401 error is stored and returned
 *      with its token bytes scrubbed.
 *
 * This is the README-facing evidence for day-10's acceptance criteria — a stub
 * transport, never a live credential. `writebackEnabled` is the same gate the
 * `/api/reviews/:id/decision` route uses.
 */

import { GitProviderType, TicketProviderType, WritebackAction } from '@harness/domain';
import type {
  WriteBackIntent,
  WritebackClaim,
  WritebackFinalize,
  WritebackLogStore,
} from '@harness/domain';
import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { StaticGitToolMap } from '@harness/git-provider';
import { StaticTicketToolMap } from '@harness/ticket-provider';
import { MCPWriteBack } from '@harness/writeback';
import type { WriteBackService } from '@harness/writeback';

import { writebackEnabled } from '../src/writeback-gate.js';

/** A fake client that records every `callTool` and reports a host handle. */
class RecordingClient implements McpClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  initialize() {
    return Promise.resolve({ name: 'fake', version: '0.0.0' });
  }

  listTools() {
    return Promise.resolve([]);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    return {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ id: `fake-${this.calls.length}` }) }],
    };
  }

  close() {
    return Promise.resolve();
  }
}

/** A client whose `callTool` rejects — models a transport/host 401 (day-08 §2.3). */
class ThrowingClient implements McpClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(private readonly error: Error) {}

  initialize() {
    return Promise.resolve({ name: 'fake', version: '0.0.0' });
  }

  listTools() {
    return Promise.resolve([]);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    throw this.error;
  }

  close() {
    return Promise.resolve();
  }
}

type Row = {
  intentId: string;
  decisionId?: string;
  dedupKey: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DUPLICATE';
  externalRef?: string;
  error?: string;
};

/** An in-memory audit store mirroring the real claim-then-write dedup semantics. */
class MemoryWritebackLogStore implements WritebackLogStore {
  readonly rows: Row[] = [];

  async claim(input: WritebackClaim): Promise<'claimed' | 'duplicate'> {
    const duplicate = this.rows.some(
      (row) => row.dedupKey === input.dedupKey && row.status === 'SUCCEEDED',
    );
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
      if (input.externalRef !== undefined) {
        row.externalRef = input.externalRef;
      }
      if (input.error !== undefined) {
        row.error = input.error;
      }
    }
  }
}

/** A registry that hands out one client, recording which provider names were asked for. */
function registryOf(client: McpClient): McpServerRegistry & { gets: string[] } {
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

/** A hard assertion — the demo exits non-zero with a clear message on any miss. */
function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`[demo:writeback] assertion failed: ${label}`);
  }
}

/** Build the git write intents for one APPROVE decision (comment + status). */
function gitDecision(
  decisionId: string,
  provider: 'github' | 'gitlab' | 'bitbucket',
  repo: string,
  number: string,
): [WriteBackIntent, WriteBackIntent] {
  const comment: WriteBackIntent = {
    id: `${decisionId}-comment`,
    provider,
    externalId: number,
    action: WritebackAction.Comment,
    body: `Review decision: APPROVE — ${decisionId}`,
    repo,
    decisionId,
  };
  const status: WriteBackIntent = {
    id: `${decisionId}-status`,
    provider,
    externalId: number,
    action: WritebackAction.Status,
    state: 'success',
    body: 'Review decision: APPROVE',
    repo,
    decisionId,
  };
  return [comment, status];
}

/** Build the Jira write intents for one APPROVE decision (comment + transition). */
function jiraDecision(decisionId: string): [WriteBackIntent, WriteBackIntent] {
  const comment: WriteBackIntent = {
    id: `${decisionId}-comment`,
    provider: TicketProviderType.Jira,
    externalId: 'ACME-42',
    action: WritebackAction.Comment,
    body: `Review decision: APPROVE — ${decisionId}`,
    decisionId,
  };
  const transition: WriteBackIntent = {
    id: `${decisionId}-transition`,
    provider: TicketProviderType.Jira,
    externalId: 'ACME-42',
    action: WritebackAction.Transition,
    toState: 'In Review',
    decisionId,
  };
  return [comment, transition];
}

/** A fresh ON service: per-provider toggle armed, isolated client + store. */
function onService(): {
  service: WriteBackService;
  client: RecordingClient;
  store: MemoryWritebackLogStore;
  registry: { gets: string[] };
} {
  const client = new RecordingClient();
  const store = new MemoryWritebackLogStore();
  const registry = registryOf(client);
  const service = new MCPWriteBack(
    registry,
    new StaticGitToolMap(),
    new StaticTicketToolMap(),
    store,
    { enabled: () => true },
  );
  return { service, client, store, registry };
}

async function main(): Promise<void> {
  console.log();
  console.log('demo:writeback — day-10 Week-2 checkpoint (one decision, ON vs OFF, stubbed)');
  console.log();

  // --- 1. The three-layer toggle (request flag ∧ global ceiling, then per-provider) ----
  console.log('=== 1. the three-layer toggle (request flag ∧ global ceiling; per-provider) ===');
  console.log(
    `  global ceiling:  writebackEnabled(true, {})                     → ${writebackEnabled(true, {})}`,
  );
  console.log(
    `  global ceiling:  writebackEnabled(true, { WRITEBACK_ENABLED:'1' }) → ${writebackEnabled(true, { WRITEBACK_ENABLED: '1' })}`,
  );
  console.log(
    `  global ceiling:  writebackEnabled(true, { WRITEBACK_ENABLED:'0' }) → ${writebackEnabled(true, { WRITEBACK_ENABLED: '0' })}`,
  );
  console.log(
    `  request flag:    writebackEnabled(undefined, { WRITEBACK_ENABLED:'1' }) → ${writebackEnabled(undefined, { WRITEBACK_ENABLED: '1' })}`,
  );
  assert(writebackEnabled(true, {}) === true, 'ON by default (no WRITEBACK_ENABLED)');
  assert(
    writebackEnabled(true, { WRITEBACK_ENABLED: '1' }) === true,
    'global ceiling + request flag both ON',
  );
  assert(
    writebackEnabled(true, { WRITEBACK_ENABLED: '0' }) === false,
    'an explicit WRITEBACK_ENABLED=0 defeats a request-level ON',
  );
  assert(
    writebackEnabled(undefined, { WRITEBACK_ENABLED: '1' }) === false,
    'a missing request flag defeats an ON ceiling',
  );

  // The per-provider layer, **on by default**: a default service (no `enabled`
  // override → `envEnabled` reads `WRITEBACK_GITHUB`, unset ⇒ ON) writes one tool
  // call. Explicit OFF is the injected `enabled: () => false` below.
  const defaultClient = new RecordingClient();
  const defaultStore = new MemoryWritebackLogStore();
  const defaultService = new MCPWriteBack(
    registryOf(defaultClient),
    new StaticGitToolMap(),
    new StaticTicketToolMap(),
    defaultStore,
  );
  const [onComment] = gitDecision('dec-on', GitProviderType.GitHub, 'github.com/acme/api', '42');
  const onResult = await defaultService.write(onComment);
  assert(onResult.ok === true, 'per-provider default ON writes ok');
  assert(defaultClient.calls.length === 1, 'per-provider default ON: one tool call');
  assert(defaultStore.rows.length === 1, 'per-provider default ON: one audit row');
  console.log(
    `  per-provider:    WRITEBACK_GITHUB unset → write() calls ${defaultClient.calls.length} tool, ${defaultStore.rows.length} audit row ✓`,
  );

  const offClient = new RecordingClient();
  const offStore = new MemoryWritebackLogStore();
  const offService = new MCPWriteBack(
    registryOf(offClient),
    new StaticGitToolMap(),
    new StaticTicketToolMap(),
    offStore,
    { enabled: () => false },
  );
  const [offComment] = gitDecision('dec-off', GitProviderType.GitHub, 'github.com/acme/api', '42');
  const offResult = await offService.write(offComment);
  assert(offResult.ok === true, 'per-provider OFF still returns ok (lazy no-op)');
  assert(offClient.calls.length === 0, 'per-provider OFF: zero tool calls');
  assert(offStore.rows.length === 0, 'per-provider OFF: zero audit rows');
  console.log(
    `  per-provider:    enabled=()=>false → write() calls ${offClient.calls.length} tools, ${offStore.rows.length} audit rows ✓`,
  );
  console.log();

  // --- 2. ON: the full provider matrix -------------------------------------------------
  console.log('=== 2. APPROVE (ON) → one decision writes COMMENT + STATUS across git hosts ===');
  const matrix: Array<{
    host: string;
    provider: 'github' | 'gitlab' | 'bitbucket';
    repo: string;
    number: string;
    commentTool: string;
    statusTool: string;
  }> = [
    {
      host: 'github.com',
      provider: GitProviderType.GitHub,
      repo: 'github.com/acme/api',
      number: '42',
      commentTool: 'add_pr_comment',
      statusTool: 'set_pr_status',
    },
    {
      host: 'gitlab.com',
      provider: GitProviderType.GitLab,
      repo: 'gitlab.com/acme/api',
      number: '7',
      commentTool: 'create_mr_note',
      statusTool: 'set_mr_status',
    },
    {
      host: 'bitbucket.org',
      provider: GitProviderType.Bitbucket,
      repo: 'bitbucket.org/acme/api',
      number: '3',
      commentTool: 'add_pr_comment',
      statusTool: 'set_pr_status',
    },
  ];

  for (const host of matrix) {
    const { service, client, store, registry } = onService();
    const [comment, status] = gitDecision(
      `dec-${host.host}`,
      host.provider,
      host.repo,
      host.number,
    );
    const commentResult = await service.write(comment);
    const statusResult = await service.write(status);

    assert(commentResult.ok === true, `${host.host} COMMENT ok`);
    assert(statusResult.ok === true, `${host.host} STATUS ok`);
    assert(client.calls.length === 2, `${host.host} made exactly two tool calls`);
    assert(
      registry.gets.every((g) => g === host.provider),
      `${host.host} resolved as ${host.provider}`,
    );
    assert(
      client.calls.map((c) => c.name).join(',') === `${host.commentTool},${host.statusTool}`,
      `${host.host} mapped to ${host.commentTool} + ${host.statusTool}`,
    );
    const succeeded = store.rows.filter((r) => r.status === 'SUCCEEDED');
    assert(succeeded.length === 2, `${host.host} recorded two SUCCEEDED rows`);
    assert(
      succeeded.every((r) => r.decisionId === `dec-${host.host}`),
      `${host.host} linked rows to the decision`,
    );
    assert(
      succeeded.every((r) => r.externalRef !== undefined),
      `${host.host} recovered a host handle (externalRef)`,
    );
    console.log(
      `  ${host.host.padEnd(13)} COMMENT+STATUS → ${client.calls.map((c) => c.name).join(', ')} · ${succeeded.map((r) => r.externalRef).join(', ')} ✓`,
    );
  }

  const {
    service: jiraService,
    client: jiraClient,
    store: jiraStore,
    registry: jiraRegistry,
  } = onService();
  const [jiraComment, jiraTransition] = jiraDecision('dec-jira');
  const jiraCommentResult = await jiraService.write(jiraComment);
  const jiraTransitionResult = await jiraService.write(jiraTransition);
  assert(jiraCommentResult.ok === true, 'Jira COMMENT ok');
  assert(jiraTransitionResult.ok === true, 'Jira TRANSITION ok');
  assert(jiraClient.calls.length === 2, 'Jira made exactly two tool calls');
  assert(
    jiraClient.calls.map((c) => c.name).join(',') === 'add_comment,transition_issue',
    'Jira mapped to add_comment + transition_issue',
  );
  assert(
    jiraRegistry.gets.every((g) => g === 'jira'),
    'Jira resolved as jira',
  );
  assert(
    jiraStore.rows.filter((r) => r.status === 'SUCCEEDED').length === 2,
    'Jira recorded two SUCCEEDED rows',
  );
  console.log(
    `  ${'jira'.padEnd(13)} COMMENT+TRANSITION → ${jiraClient.calls.map((c) => c.name).join(', ')} ✓`,
  );
  console.log();

  // --- 3. Idempotency: a retried decision is DUPLICATE, one external write ------------
  console.log('=== 3. idempotency — a retried decision writes once, then DUPLICATE ===');
  const { service: idemService, client: idemClient, store: idemStore } = onService();
  const decisionId = 'dec-dup';
  const [first] = gitDecision(decisionId, GitProviderType.GitHub, 'github.com/acme/api', '42');
  await idemService.write(first);
  const retry: WriteBackIntent = { ...first, id: `${decisionId}-comment-retry` };
  const retryResult = await idemService.write(retry);

  assert(retryResult.ok === true, 'retried decision still resolves ok (no error)');
  assert(idemClient.calls.length === 1, 'retried decision: exactly one external write');
  const statuses = idemStore.rows.map((r) => r.status).sort();
  assert(
    JSON.stringify(statuses) === JSON.stringify(['DUPLICATE', 'SUCCEEDED']),
    'retried decision: one SUCCEEDED + one DUPLICATE audit row',
  );
  console.log(
    `  external writes: ${idemClient.calls.length} · audit rows: ${statuses.join(', ')} ✓`,
  );
  console.log();

  // --- 4. Redaction: a forced 401 never leaks token bytes -----------------------------
  console.log('=== 4. redaction — a forced 401 stores and returns a scrubbed error ===');
  const secret = 'ghp_abcexampletoken12345';
  const throwing = new ThrowingClient(new Error(`Authorization: Bearer ${secret} rejected`));
  const redactStore = new MemoryWritebackLogStore();
  const redactService = new MCPWriteBack(
    registryOf(throwing),
    new StaticGitToolMap(),
    new StaticTicketToolMap(),
    redactStore,
    { enabled: () => true },
  );
  const [bad] = gitDecision('dec-401', GitProviderType.GitHub, 'github.com/acme/api', '42');
  const badResult = await redactService.write(bad);

  assert(badResult.ok === false, 'the 401 resolves as a FAILED write, not a throw');
  assert(!badResult.error?.includes(secret), 'returned error has no token bytes');
  assert(badResult.error?.includes('[redacted]') === true, 'returned error is masked');
  assert(redactStore.rows[0]?.status === 'FAILED', 'audit row is FAILED');
  assert(!redactStore.rows[0]?.error?.includes(secret), 'stored error has no token bytes');
  console.log(`  returned: "${badResult.error}"`);
  console.log(`  stored:   "${redactStore.rows[0]?.error}"`);
  console.log();

  console.log('week-2 milestone: APPROVE (ON) lands COMMENT + STATUS / COMMENT + TRANSITION;');
  console.log(
    'OFF is provably silent (zero calls, zero rows), retries dedup, and errors are redacted. ✅',
  );
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error('[demo:writeback] FAILED:', err);
    process.exit(1);
  },
);
