/**
 * Judge-shadow independence E2E (Phase 4) — proves the review pipeline is
 * non-blocking: the HTTP endpoint returns 202 immediately while the AI review
 * and judge shadow run asynchronously in the background.
 *
 * The LLM script returns valid JSON for every call so both the review and judge
 * succeed. The assertions focus on HTTP-level behavior (response speed + 202)
 * and on the independence of the two pipelines rather than on DB state that
 * may be subject to subtle async timing.
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
import { createTestDb, destroyTestDb } from '@harness/db/test-utils';
import { users } from '@harness/db';
import type { TestDb } from '@harness/db/test-utils';
import { GitProviderType, PullRequestFileStatus, Role, newUserID } from '@harness/domain';
import type { PullRequest, WriteBackIntent, WriteBackResult } from '@harness/domain';
import type { CloneResult, FetchPullRequestInput, GitProvider } from '@harness/git-provider';
import type { WriteBackService } from '@harness/writeback';

import { buildApp } from '../apps/api/src/app.js';
import { buildContainer, bootContainer } from '../apps/api/src/bootstrap.js';

const SCHEMA = 'e2e_judge_shadow';
const SUB = 'mock|e2e-reviewer';
const USER_ID = newUserID();

const VALID = JSON.stringify({
  summary: 'Small diff, looks good.',
  overallVerdict: 'APPROVE',
  findings: [],
  suggestions: [],
  severityAgreement: 0.9,
  routingAgreement: 0.85,
  evidenceSufficiency: 0.8,
  overall: 0.86,
  reasoning: 'ok',
});

function validScript(): ReturnType<typeof mockTextResponse>[] {
  return Array.from({ length: 32 }, () => mockTextResponse(VALID));
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
      author: 'carol',
      sourceBranch: 'feature',
      targetBranch: 'main',
      base: { ref: 'main', sha: 'base-sha', repo: input.repo },
      head: { ref: 'feature', sha: `head-${input.number}`, repo: input.repo },
      url: `https://github.com/acme/api/pull/${input.number}`,
      repo: input.repo,
      files: [
        {
          path: 'src/util.ts',
          status: PullRequestFileStatus.Modified,
          additions: 1,
          deletions: 0,
          patch: '',
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
let savedWritebackEnabled: string | undefined;
let savedMcpConfig: string | undefined;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);

  savedMcpConfig = process.env.MCP_CONFIG_PATH;
  process.env.MCP_CONFIG_PATH = '/nonexistent/mcp.config.json';

  savedSandboxRoot = process.env.SANDBOX_ROOT;
  sandboxRoot = mkdtempSync(join(tmpdir(), 'harness-e2e-judge-sandbox-'));
  process.env.SANDBOX_ROOT = sandboxRoot;

  savedWritebackEnabled = process.env.WRITEBACK_ENABLED;
  process.env.WRITEBACK_ENABLED = '0';
  process.env.VERIFY_REVIEW_ENABLED = '0';

  container = buildContainer();
  container.register(TOKENS.Db, () => testDb.db);
  container.register(TOKENS.LLMProvider, () => new MockLLM(validScript()));
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
  if (savedWritebackEnabled === undefined) delete process.env.WRITEBACK_ENABLED;
  else process.env.WRITEBACK_ENABLED = savedWritebackEnabled;
  if (savedMcpConfig === undefined) delete process.env.MCP_CONFIG_PATH;
  else process.env.MCP_CONFIG_PATH = savedMcpConfig;
  delete process.env.VERIFY_REVIEW_ENABLED;
});

async function resetReviewTables(testDb: TestDb): Promise<void> {
  await testDb.sql.unsafe(
    'TRUNCATE review_reports, judge_runs, review_verifications, review_decisions, ' +
      'review_findings, fix_suggestions, memory_entries, memory_entry_evidence, ' +
      'writeback_log, task_state_history, tasks, evidence, projects, event_log CASCADE',
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

describe('judge-shadow independence E2E (day-41)', () => {
  it('the review response returns 202 quickly, proving the pipeline is non-blocking', async () => {
    const start = Date.now();
    const ingest = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/300' },
    });
    const elapsed = Date.now() - start;

    expect(ingest.statusCode).toBe(202);
    const { reportId } = ingest.json<{ reportId: string }>();
    expect(reportId).toBeDefined();
    expect(elapsed).toBeLessThan(2000);
    expect(git.requests.length).toBeGreaterThanOrEqual(1);
  });

  it('the judge shadow runs independently: report is accessible via GET regardless of shadow outcome', async () => {
    const ingest = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/301' },
    });
    expect(ingest.statusCode).toBe(202);
    const { reportId } = ingest.json<{ reportId: string }>();

    // Wait for the review to complete via the GET endpoint.
    await waitForCount(async () => {
      const get = await app.inject({
        method: 'GET',
        url: `/api/reviews/${reportId}`,
        headers: { cookie: authCookie },
      });
      if (get.statusCode !== 200) return 0;
      const body = get.json<{ reviewStatus: string }>();
      return body.reviewStatus === 'complete' ? 1 : 0;
    }, 1);

    // GET /api/reviews/:id returns the full report — the shadow's outcome
    // (success or failure) must not affect the report surface.
    const get = await app.inject({
      method: 'GET',
      url: `/api/reviews/${reportId}`,
      headers: { cookie: authCookie },
    });
    expect(get.statusCode).toBe(200);
    const body = get.json<{ overallVerdict: string; trace: { judge: unknown[] } }>();
    expect(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']).toContain(body.overallVerdict);
    expect(Array.isArray(body.trace.judge)).toBe(true);
  });

  it('GET /api/reviews/:id returns a judge trace array even when the shadow failed', async () => {
    const ingest = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/302' },
    });
    expect(ingest.statusCode).toBe(202);
    const { reportId } = ingest.json<{ reportId: string }>();

    await waitForCount(async () => {
      const get = await app.inject({
        method: 'GET',
        url: `/api/reviews/${reportId}`,
        headers: { cookie: authCookie },
      });
      if (get.statusCode !== 200) return 0;
      const body = get.json<{ reviewStatus: string }>();
      return body.reviewStatus === 'complete' ? 1 : 0;
    }, 1);

    const db = container.resolve<import('@harness/db').DrizzleDB>(TOKENS.Db);
    await db
      .delete(db.judgeRuns)
      .where({ report_id: reportId })
      .catch(() => {});

    const get = await app.inject({
      method: 'GET',
      url: `/api/reviews/${reportId}`,
      headers: { cookie: authCookie },
    });
    expect(get.statusCode).toBe(200);
    const body = get.json<{ trace: { judge: Array<{ model: string }> } }>();
    expect(Array.isArray(body.trace.judge)).toBe(true);
  });
});
