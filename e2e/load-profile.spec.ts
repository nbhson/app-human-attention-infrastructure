/**
 * Load profile (Phase 3 day-37 §3.3) — correctness-under-concurrency, not a perf
 * benchmark. §2.2 is explicit: a handful of simultaneous reviews is enough to
 * prove the system holds together; the assertions that matter are **isolation**
 * (no config/token bleed) and **teardown** (no leaked sandboxes).
 *
 * Two seams are driven at once, matching the two real ingress paths:
 *
 *  1. The full HTTP stack (`POST /api/reviews` → `ReviewIngestService` → DB/bus/
 *     memory/judge) under 10 concurrent requests, real internals, stubbed LLM.
 *     The assertion is per-report: each review's repo/number/title land in their
 *     own rows with no cross-contamination, and each fires exactly one judge run.
 *
 *  2. The MCP multi-host facade (`resolveReviewInput` → `parsePrUrl` →
 *     `MCPGitProvider` → `StaticGitToolMap`) under 10 interleaved GitHub+GitLab
 *     requests. The Git host seam is stubbed with an args-aware, per-host client
 *     that *echoes the requested number back*; any cross-host tool call is a
 *     tripwire. This is the "no token/config bleed" proof: a request routed to the
 *     wrong host either gets the wrong number back or throws out-of-scope.
 *
 * The sandbox probe then asserts the review slice leaked nothing into
 * `SANDBOX_ROOT` — the read-only review path never clones, so "no leaked
 * sandbox" is an emptiable fact, not an absence we hope for.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockLLM, mockTextResponse } from '@harness/agent-runtime';
import { MockOidcProvider } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import type { DrizzleDB } from '@harness/db';
import {
  eventLog,
  evidence,
  fixSuggestions,
  judgeRuns,
  memoryEntries,
  memoryEntryEvidence,
  projects,
  reviewDecisions,
  reviewFindings,
  reviewReports,
  taskStateHistory,
  tasks,
  users,
  writebackLog,
} from '@harness/db';
import { createTestDb, destroyTestDb } from '@harness/db/test-utils';
import type { TestDb } from '@harness/db/test-utils';
import {
  GitProviderType,
  PullRequestFileStatus,
  Role,
  TicketProviderType,
  newUserID,
} from '@harness/domain';
import type { Issue, PullRequest, WriteBackIntent, WriteBackResult } from '@harness/domain';
import type { CloneResult, FetchPullRequestInput, GitProvider } from '@harness/git-provider';
import type { FetchIssueInput, TicketProvider } from '@harness/ticket-provider';
import type { WriteBackService } from '@harness/writeback';
import type { McpClient, McpServerRegistry, ToolResult } from '@harness/mcp';
import { McpConfigError } from '@harness/mcp';

import { buildApp } from '../apps/api/src/app.js';
import { buildContainer, bootContainer } from '../apps/api/src/bootstrap.js';
import { resolveReviewInput } from '../apps/api/src/review-input-facade.js';

const SCHEMA = 'e2e_load_profile';
const SUB = 'mock|e2e-reviewer';
const USER_ID = newUserID();

/** One response valid for both the review and judge parsers (see full-system). */
const DUAL_VALID = JSON.stringify({
  summary: 'The diff is small and correct; one edge case worth a human glance.',
  overallVerdict: 'APPROVE',
  findings: [
    {
      severity: 'MAJOR',
      file: 'src/calc.ts',
      line: 42,
      message: 'Integer overflow when the two factors are both large.',
      suggestion: 'Clamp the inputs or promote the multiplication to BigInt.',
    },
  ],
  suggestions: [
    {
      file: 'src/calc.ts',
      proposed: 'add a range guard before the multiplication',
      rationale: 'Prevents a silent overflow at runtime.',
    },
  ],
  severityAgreement: 0.9,
  routingAgreement: 0.85,
  evidenceSufficiency: 0.8,
  overall: 0.86,
  reasoning: 'the review is well-scoped and traceable',
});

/** 64 identical entries — far more than the 10 reviews + 10 judge shadows need. */
function dualValidScript(): ReturnType<typeof mockTextResponse>[] {
  return Array.from({ length: 64 }, () => mockTextResponse(DUAL_VALID));
}

/** Stubbed Git seam for the full-stack path; echoes its `repo`/`number` back. */
class FakeGitProvider implements GitProvider {
  readonly requests: FetchPullRequestInput[] = [];

  async fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest> {
    this.requests.push(input);
    return {
      provider: GitProviderType.GitHub,
      number: input.number,
      title: `PR ${input.number}`,
      description: 'stubbed',
      author: 'alice',
      sourceBranch: 'feature',
      targetBranch: 'main',
      base: { ref: 'main', sha: 'base-sha', repo: input.repo },
      head: { ref: 'feature', sha: `head-${input.number}`, repo: input.repo },
      url: `https://${input.repo}/pull/${input.number}`,
      repo: input.repo,
      files: [
        {
          path: 'src/calc.ts',
          status: PullRequestFileStatus.Modified,
          additions: 2,
          deletions: 1,
          patch: '@@ -1,1 +1,1 @@\n- a * b\n+ a * b // reviewed',
        },
      ],
    };
  }

  async postComment(): Promise<void> {
    throw new Error('FakeGitProvider.postComment must not be exercised');
  }

  async setStatus(): Promise<void> {
    throw new Error('FakeGitProvider.setStatus must not be exercised');
  }

  async cloneAndCheckout(): Promise<CloneResult> {
    throw new Error('FakeGitProvider.cloneAndCheckout must not be exercised');
  }
}

/** Stubbed Jira seam — the load profile never supplies a ticket, so this stays empty. */
class FakeTicketProvider implements TicketProvider {
  readonly type = TicketProviderType.Jira;
  readonly requests: FetchIssueInput[] = [];

  async fetchIssue(input: FetchIssueInput): Promise<Issue> {
    this.requests.push(input);
    return {
      provider: TicketProviderType.Jira,
      key: input.key,
      summary: `Requirement for ${input.key}`,
      description: 'Acceptance criteria read by the reviewer.',
      issueType: 'Story',
      url: `https://acme.atlassian.net/browse/${input.key}`,
    };
  }

  async postComment(): Promise<void> {
    throw new Error('FakeTicketProvider.postComment must not be exercised');
  }

  async transition(): Promise<void> {
    throw new Error('FakeTicketProvider.transition must not be exercised');
  }
}

/** Records any write it is asked to make — asserts nothing is written at rest. */
class RecordingWriteBack implements WriteBackService {
  readonly writes: WriteBackIntent[] = [];

  async write(intent: WriteBackIntent): Promise<WriteBackResult> {
    this.writes.push(intent);
    return { ok: true, intentId: intent.id };
  }
}

/** A one-document MCP tool result (the `text`-block encoding the mapper accepts). */
function toolText(json: unknown): ToolResult {
  return { isError: false, content: [{ type: 'text', text: JSON.stringify(json) }] };
}

/**
 * A per-host MCP client whose PR tool *echoes the requested number back* from its
 * host-specific argument key. Any tool name the host does not own is a tripwire —
 * the "wrong token/config" bug the day-36 hardening and this load profile exist to
 * catch (day-37 §2.2, §6).
 */
class ArgsAwareMcpClient implements McpClient {
  readonly calls: Array<{ tool: string; args: Record<string, unknown> }> = [];

  constructor(
    private readonly host: GitProviderType,
    private readonly getPrTool: string,
    private readonly getFilesTool: string,
    private readonly numberArg: 'pull_number' | 'merge_request_iid',
  ) {}

  initialize(): Promise<{ name: string; version: string }> {
    return Promise.resolve({ name: this.host, version: '0.0.0' });
  }

  listTools(): Promise<never> {
    return Promise.reject(new Error('listTools not used in the fetch path'));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ tool: name, args });
    if (name === this.getPrTool) {
      const number = Number(args[this.numberArg]);
      return toolText({
        number,
        title: `PR ${number}`,
        author: 'alice',
        head: { ref: 'feature', sha: `head-${number}` },
        base: { ref: 'main', sha: 'base-${number}' },
        url: `https://${this.host}.example/acme/api/pull/${number}`,
      });
    }
    if (name === this.getFilesTool) {
      return toolText([
        { path: `src/${this.host}.ts`, status: 'modified', additions: 1, deletions: 0 },
      ]);
    }
    throw new Error(`${this.host} client received an out-of-scope tool call: ${name}`);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** A registry that hands out one client per host and records every lookup. */
class HostKeyedRegistry implements McpServerRegistry {
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

  closeAll(): Promise<void> {
    return Promise.resolve();
  }
}

let testDb: TestDb;
let container: Container;
let app: ReturnType<typeof buildApp>;
let git: FakeGitProvider;
let ticket: FakeTicketProvider;
let writeback: RecordingWriteBack;
let authCookie = '';
let sandboxRoot: string;
let savedSandboxRoot: string | undefined;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);

  savedSandboxRoot = process.env.SANDBOX_ROOT;
  sandboxRoot = mkdtempSync(join(tmpdir(), 'harness-e2e-load-sandbox-'));
  process.env.SANDBOX_ROOT = sandboxRoot;

  container = buildContainer();
  container.register(TOKENS.Db, () => testDb.db);
  container.register(TOKENS.LLMProvider, () => new MockLLM(dualValidScript()));
  git = new FakeGitProvider();
  ticket = new FakeTicketProvider();
  writeback = new RecordingWriteBack();
  container.register(TOKENS.GitProvider, () => git);
  container.register(TOKENS.TicketProvider, () => ticket);
  container.register(TOKENS.WriteBackService, () => writeback);
  // Replace the env-driven OIDC provider with the mock AFTER `buildContainer`
  // so login resolves a deterministic REVIEWER principal.
  container.register(
    TOKENS.OidcProvider,
    () => new MockOidcProvider({ sub: SUB, email: 'reviewer@example.com', name: 'E2E Reviewer' }),
  );
  bootContainer(container);

  app = buildApp(container);
  await app.ready();

  await seedReviewer();
  authCookie = await loginCookie();
});

afterAll(async () => {
  await app.close();
  await destroyTestDb(testDb, SCHEMA);
  rmSync(sandboxRoot, { recursive: true, force: true });
  if (savedSandboxRoot === undefined) {
    delete process.env.SANDBOX_ROOT;
  } else {
    process.env.SANDBOX_ROOT = savedSandboxRoot;
  }
});

async function resetReviewTables(db: DrizzleDB): Promise<void> {
  await db.delete(memoryEntryEvidence);
  await db.delete(memoryEntries);
  await db.delete(writebackLog);
  await db.delete(reviewDecisions);
  await db.delete(reviewFindings);
  await db.delete(fixSuggestions);
  await db.delete(judgeRuns);
  await db.delete(reviewReports);
  await db.delete(taskStateHistory);
  await db.delete(tasks);
  await db.delete(evidence);
  await db.delete(projects);
  await db.delete(eventLog);
}

beforeEach(async () => {
  await resetReviewTables(testDb.db);
});

/** Poll until `count()` reaches `expected` — judge shadows are fire-and-forget. */
async function waitForCount(count: () => Promise<number>, expected: number): Promise<void> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const n = await count();
    if (n >= expected) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${expected} row(s); saw ${n}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Seed the reviewer principal so the mock login preserves its REVIEWER role. */
async function seedReviewer(): Promise<void> {
  await testDb.db.insert(users).values({
    id: USER_ID,
    oidc_sub: SUB,
    email: 'reviewer@example.com',
    display_name: 'E2E Reviewer',
    roles: [Role.Operate, Role.Reviewer],
  });
}

/** Complete a mock OIDC login and return the resulting `sid` cookie. */
async function loginCookie(): Promise<string> {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const location = new URL(login.headers.location!);
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${location.searchParams.get('code')}&state=${location.searchParams.get('state')}`,
  });
  expect(callback.statusCode).toBe(200);
  return callback.headers['set-cookie']!.toString().split(';')[0]!; // "sid=..."
}

describe('load profile (day-37)', () => {
  it('10 concurrent full-system reviews land distinct, un-bleeded reports', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);
    const reviews = Array.from({ length: 10 }, (_, i) => ({
      prUrl: `https://github.com/acme/api-${i}/pull/${100 + i}`,
      repo: `github.com/acme/api-${i}`,
      number: 100 + i,
    }));

    const replies = await Promise.all(
      reviews.map((r) =>
        app.inject({
          method: 'POST',
          url: '/api/reviews',
          headers: { cookie: authCookie },
          payload: { prUrl: r.prUrl },
        }),
      ),
    );

    // Every request succeeded and returned a distinct report id.
    for (const reply of replies) {
      expect(reply.statusCode).toBe(201);
    }
    const created = replies.map((r) => r.json<{ reportId: string }>());
    expect(new Set(created.map((c) => c.reportId)).size).toBe(10);

    // Isolation at the seam: the stub was asked for exactly the 10 repos/numbers,
    // and the reports re-encoded them with no cross-contamination.
    expect(git.requests).toHaveLength(10);
    expect(new Set(git.requests.map((r) => `${r.repo}#${r.number}`))).toEqual(
      new Set(reviews.map((r) => `${r.repo}#${r.number}`)),
    );

    const reports = await db.select().from(reviewReports);
    expect(reports).toHaveLength(10);
    // Distinct repos → distinct projects, no get-or-create race on repo_path.
    expect(new Set(reports.map((r) => r.repo)).size).toBe(10);
    // Every report's pr_number matches its own repo (repo `api-N` ↔ number `100+N`).
    for (const report of reports) {
      const suffix = report.repo.split('-').pop();
      expect(report.pr_number).toBe(100 + Number(suffix));
    }

    // No ticket was requested (none supplied) and nothing was written back.
    expect(ticket.requests).toHaveLength(0);
    expect(writeback.writes).toHaveLength(0);

    // Each review's shadow judge fired exactly once.
    await waitForCount(async () => {
      const rows = await db.select().from(judgeRuns);
      return rows.length;
    }, 10);
    const runs = await db.select().from(judgeRuns);
    expect(runs).toHaveLength(10);
  });

  it('10 interleaved GitHub + GitLab ingests resolve their own hosts with no token bleed', async () => {
    const github = new ArgsAwareMcpClient(
      GitProviderType.GitHub,
      'get_pull_request',
      'list_pull_request_files',
      'pull_number',
    );
    const gitlab = new ArgsAwareMcpClient(
      GitProviderType.GitLab,
      'get_merge_request',
      'list_merge_request_diffs',
      'merge_request_iid',
    );
    const registry = new HostKeyedRegistry(
      new Map([
        [GitProviderType.GitHub, github],
        [GitProviderType.GitLab, gitlab],
      ]),
    );

    const requests = [
      ...Array.from({ length: 5 }, (_, i) => ({
        prUrl: `https://github.com/acme/api/pull/${1 + i}`,
        host: GitProviderType.GitHub,
        number: 1 + i,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        prUrl: `https://gitlab.com/acme/api/-/merge_requests/${101 + i}`,
        host: GitProviderType.GitLab,
        number: 101 + i,
      })),
    ];

    const results = await Promise.all(
      requests.map((r) => resolveReviewInput({ prUrl: r.prUrl }, { registry })),
    );

    // Each concurrent review resolved to its own host and its own PR number.
    for (let i = 0; i < requests.length; i += 1) {
      expect(results[i]?.pullRequest.provider).toBe(requests[i]?.host);
      expect(results[i]?.pullRequest.number).toBe(requests[i]?.number);
    }

    // Each host was looked up exactly once per request on that host (5 apiece).
    expect(registry.getRequests.filter((n) => n === GitProviderType.GitHub)).toHaveLength(5);
    expect(registry.getRequests.filter((n) => n === GitProviderType.GitLab)).toHaveLength(5);

    // The tripwire: no client was ever asked a tool it does not own.
    expect([...new Set(github.calls.map((c) => c.tool))].sort()).toEqual([
      'get_pull_request',
      'list_pull_request_files',
    ]);
    expect([...new Set(gitlab.calls.map((c) => c.tool))].sort()).toEqual([
      'get_merge_request',
      'list_merge_request_diffs',
    ]);
  });

  it('teardown: the concurrent review runs leaked nothing into the sandbox root', async () => {
    // The 10 full-system reviews and the 10 multi-host facade ingests already ran
    // against this `SANDBOX_ROOT`. The review slice is read-only over the sandbox
    // (it clones/checks out nothing — that path belongs to verification), so "no
    // leaked sandbox" is an emptiable fact: any leaked workdir would appear as an
    // entry here.
    expect(readdirSync(sandboxRoot)).toEqual([]);
    expect(writeback.writes).toHaveLength(0);
  });
});
