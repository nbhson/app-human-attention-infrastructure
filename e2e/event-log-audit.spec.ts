/**
 * Event-log audit E2E (Phase 3) — provenance trail shape and completeness.
 *
 * Asserts:
 *  1. Each review gets a unique correlation_id, written to review_reports.
 *  2. The event_log contains well-typed rows after ingest.
 *  3. Concurrent reviews have distinct correlation_ids (no cross-contamination).
 *  4. The audit API endpoint returns events for the correlation_id.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { waitForCount } from './utils/wait.js';

import { MockLLM, mockTextResponse } from '@harness/agent-runtime';
import { MockOidcProvider } from '@harness/auth';
import { TOKENS } from '@harness/di';
import type { Container } from '@harness/di';
import { eventLog, reviewReports, users } from '@harness/db';
import { createTestDb, destroyTestDb } from '@harness/db/test-utils';
import type { TestDb } from '@harness/db/test-utils';
import { GitProviderType, PullRequestFileStatus, Role, newUserID } from '@harness/domain';
import type { PullRequest, WriteBackIntent, WriteBackResult } from '@harness/domain';
import type { CloneResult, FetchPullRequestInput, GitProvider } from '@harness/git-provider';
import type { WriteBackService } from '@harness/writeback';

import { buildApp } from '../apps/api/src/app.js';
import { buildContainer, bootContainer } from '../apps/api/src/bootstrap.js';

const SCHEMA = 'e2e_event_log_audit';
const SUB = 'mock|e2e-reviewer';
const USER_ID = newUserID();

const DUAL_VALID = JSON.stringify({
  summary: 'Small diff, one edge case worth a human glance.',
  overallVerdict: 'APPROVE',
  findings: [
    {
      severity: 'MAJOR',
      file: 'src/calc.ts',
      line: 42,
      message: 'Integer overflow.',
      suggestion: 'Clamp the inputs.',
    },
  ],
  suggestions: [],
  severityAgreement: 0.9,
  routingAgreement: 0.85,
  evidenceSufficiency: 0.8,
  overall: 0.86,
  reasoning: 'well-scoped',
});

function dualValidScript(): ReturnType<typeof mockTextResponse>[] {
  return Array.from({ length: 64 }, () => mockTextResponse(DUAL_VALID));
}

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
    throw new Error('must not be exercised');
  }
  async setStatus(): Promise<void> {
    throw new Error('must not be exercised');
  }
  async cloneAndCheckout(): Promise<CloneResult> {
    throw new Error('must not be exercised');
  }
}

class RecordingWriteBack implements WriteBackService {
  readonly writes: WriteBackIntent[] = [];
  async write(intent: WriteBackIntent): Promise<WriteBackResult> {
    this.writes.push(intent);
    return { ok: true, intentId: intent.id };
  }
}

let testDb: TestDb;
let container: Container;
let app: ReturnType<typeof buildApp>;
let git: FakeGitProvider;
let writeback: RecordingWriteBack;
let authCookie = '';
let sandboxRoot: string;
let savedSandboxRoot: string | undefined;
let savedMcpConfig: string | undefined;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);

  savedMcpConfig = process.env.MCP_CONFIG_PATH;
  process.env.MCP_CONFIG_PATH = '/nonexistent/mcp.config.json';

  savedSandboxRoot = process.env.SANDBOX_ROOT;
  sandboxRoot = mkdtempSync(join(tmpdir(), 'harness-e2e-audit-sandbox-'));
  process.env.SANDBOX_ROOT = sandboxRoot;

  container = buildContainer();
  container.register(TOKENS.Db, () => testDb.db);
  container.register(TOKENS.LLMProvider, () => new MockLLM(dualValidScript()));
  git = new FakeGitProvider();
  writeback = new RecordingWriteBack();
  container.register(TOKENS.GitProvider, () => git);
  container.register(TOKENS.WriteBackService, () => writeback);
  container.register(
    TOKENS.OidcProvider,
    () => new MockOidcProvider({ sub: SUB, email: 'reviewer@example.com', name: 'E2E Reviewer' }),
  );
  container.register(TOKENS.MemoryIngestor, () => ({ subscribe: () => {} }));
  container.register(TOKENS.ReviewVerificationService, () => ({ subscribe: () => {} }));
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
  if (savedSandboxRoot === undefined) delete process.env.SANDBOX_ROOT;
  else process.env.SANDBOX_ROOT = savedSandboxRoot;
  if (savedMcpConfig === undefined) delete process.env.MCP_CONFIG_PATH;
  else process.env.MCP_CONFIG_PATH = savedMcpConfig;
});

async function resetReviewTables(db: TestDb): Promise<void> {
  await db.sql.unsafe(
    'TRUNCATE review_reports, judge_runs, review_decisions, review_findings, ' +
      'fix_suggestions, memory_entries, memory_entry_evidence, writeback_log, ' +
      'task_state_history, tasks, evidence, projects, event_log CASCADE',
  );
}

beforeEach(async () => {
  await resetReviewTables(testDb);
});

async function seedReviewer(): Promise<void> {
  await testDb.db.insert(users).values({
    id: USER_ID,
    oidc_sub: SUB,
    email: 'reviewer@example.com',
    display_name: 'E2E Reviewer',
    roles: [Role.Operate, Role.Reviewer],
  });
}

async function loginCookie(): Promise<string> {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const location = new URL(login.headers.location!);
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${location.searchParams.get('code')}&state=${location.searchParams.get('state')}`,
  });
  expect(callback.statusCode).toBe(200);
  return callback.headers['set-cookie']!.toString().split(';')[0]!;
}

describe('event-log audit E2E (day-30)', () => {
  it('produces a correlation_id trail after ingest', async () => {
    const db = testDb.db;

    // Ingest a review.
    const ingest = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/600' },
    });
    expect(ingest.statusCode).toBe(202);
    const { reportId } = ingest.json<{ reportId: string }>();

    // Wait for the async review to complete.
    await waitForCount(async () => {
      const rows = await db.select().from(reviewReports);
      return rows.filter((r) => r.id === reportId && r.review_status === 'complete').length;
    }, 1);

    // correlation_id is stored on the report row.
    const reportRow = (
      await db
        .select()
        .from(reviewReports)
        .where((t) => t.id === reportId)
    )[0];
    expect(reportRow).toBeDefined();
    const correlationId = reportRow!.correlation_id;
    expect(correlationId).toBeDefined();
    expect(typeof correlationId).toBe('string');
    expect(correlationId.length).toBeGreaterThan(0);

    // Event_log has rows for this correlation_id.
    const events = await db.select().from(eventLog);
    const correlated = events.filter((e) => e.correlation_id === correlationId);
    expect(correlated.length).toBeGreaterThan(0);

    // Every event has the required shape.
    for (const event of correlated) {
      expect(event.event_id).toBeDefined();
      expect(event.event_type).toBeDefined();
      expect(event.correlation_id).toBe(correlationId);
      expect(event.payload).toBeDefined();
      expect(event.occurred_at).toBeDefined();
    }

    // Audit API returns events for this correlation_id.
    const now = new Date().toISOString();
    const auditReply = await app.inject({
      method: 'GET',
      url: `/api/audit?before=${encodeURIComponent(now)}&correlationId=${encodeURIComponent(correlationId)}`,
      headers: { cookie: authCookie },
    });
    expect(auditReply.statusCode).toBe(200);
    const auditBody = auditReply.json<{ items: Array<{ title: string }> }>();
    expect(auditBody.items.length).toBeGreaterThan(0);
    // At least one item should match our correlation_id events.
    expect(auditBody.items.some((e) => correlated.some((ev) => ev.event_type === e.title))).toBe(
      true,
    );
  });

  it('each concurrent review keeps a distinct correlation_id', async () => {
    const db = testDb.db;

    const replies = await Promise.all(
      [601, 602, 603].map((n) =>
        app.inject({
          method: 'POST',
          url: '/api/reviews',
          headers: { cookie: authCookie },
          payload: { prUrl: `https://github.com/acme/api/pull/${n}` },
        }),
      ),
    );

    for (const reply of replies) {
      expect(reply.statusCode).toBe(202);
    }

    // Wait for all three to complete.
    await waitForCount(
      async () => {
        const rows = await db.select().from(reviewReports);
        return rows.filter((r) => r.review_status === 'complete').length;
      },
      3,
      { timeoutMs: 15000 },
    );

    const reports = await db.select().from(reviewReports);
    expect(reports).toHaveLength(3);

    // Distinct correlation_ids.
    const corrIds = reports.map((r) => r.correlation_id);
    expect(new Set(corrIds).size).toBe(3);

    // Each correlation_id has its own events.
    for (const id of corrIds) {
      const events = await db
        .select()
        .from(eventLog)
        .where((t) => t.correlation_id === id);
      expect(events.length).toBeGreaterThan(0);
    }
  });
});
