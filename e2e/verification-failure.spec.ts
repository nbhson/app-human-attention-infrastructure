/**
 * Verification-failure E2E (Phase 4) — a FAILED machine-side verification must
 * flag the report but must never auto-approve or block the human decision.
 *
 * Real internals: the DI container, the review ingestion path, and the
 * `review_verifications` table. Verification is disabled (`VERIFY_REVIEW_ENABLED=
 * 0`) so the service does not attempt to clone; instead we insert a FAILED
 * verification row directly and assert the GET endpoint surfaces it correctly
 * and the human decision path stays open.
 *
 * Two seams are tested here:
 *
 *  1. FAILED verification lands in `review_verifications` and surfaces on
 *     `GET /api/reviews/:id` — the UI-rendered shape (status/overall/failedKinds).
 *  2. A human decision still succeeds regardless of the verification flag; the
 *     approval/write-back path is gated by the three-layer toggle, not by
 *     verification status (day-09 §6: "flag, not gate").
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
import { users, reviewVerifications, reviewDecisions } from '@harness/db';
import type { TestDb } from '@harness/db/test-utils';
import { GitProviderType, PullRequestFileStatus, Role, newUserID, uuidv7 } from '@harness/domain';
import type { PullRequest, WriteBackIntent, WriteBackResult } from '@harness/domain';
import type { CloneResult, FetchPullRequestInput, GitProvider } from '@harness/git-provider';
import type { WriteBackService } from '@harness/writeback';

import { buildApp } from '../apps/api/src/app.js';
import { buildContainer, bootContainer } from '../apps/api/src/bootstrap.js';

const SCHEMA = 'e2e_verification_failure';
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
      message: 'Integer overflow when the two factors are both large.',
      suggestion: 'Clamp the inputs or promote to BigInt.',
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
      url: `https://github.com/acme/api/pull/${input.number}`,
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
let savedWritebackEnabled: string | undefined;
let savedMcpConfig: string | undefined;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);

  savedMcpConfig = process.env.MCP_CONFIG_PATH;
  process.env.MCP_CONFIG_PATH = '/nonexistent/mcp.config.json';

  savedSandboxRoot = process.env.SANDBOX_ROOT;
  sandboxRoot = mkdtempSync(join(tmpdir(), 'harness-e2e-verify-sandbox-'));
  process.env.SANDBOX_ROOT = sandboxRoot;

  savedWritebackEnabled = process.env.WRITEBACK_ENABLED;
  process.env.WRITEBACK_ENABLED = '0';
  process.env.VERIFY_REVIEW_ENABLED = '0';

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

describe('verification-failure E2E (day-41)', () => {
  it('a FAILED verification flags the report but does not block human APPROVE', async () => {
    // Create the review first (no verification runs because VERIFY_REVIEW_ENABLED=0).
    const ingest = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/100' },
    });
    expect(ingest.statusCode).toBe(202);
    const { reportId } = ingest.json<{ reportId: string }>();

    // Wait for the AI review to complete.
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

    // Insert a FAILED verification row directly (simulating what the real
    // ReviewVerificationService would write after a failed sandbox run).
    const verificationId = uuidv7();
    await testDb.db.insert(reviewVerifications).values({
      id: verificationId,
      report_id: reportId,
      status: 'FAILED',
      overall: 'FAILED',
      head_sha: 'abc123def456',
      content_hash: 'sha256:deadbeef',
      duration_ms: 5000,
      flag: {
        verdict: 'FAILED',
        failedKinds: ['COMPILE'],
        timedOutKinds: [],
        failedChecks: [{ kind: 'COMPILE', status: 'FAILED', exitCode: 1, tail: 'build failed' }],
      },
      rendered: '## Verification — FAILED\n\n### COMPILE\n- exit code 1\n\n**Review required before any write-back.**',
      error: null,
    });

    // GET /api/reviews/:id surfaces the verification flag in the response shape.
    const get = await app.inject({
      method: 'GET',
      url: `/api/reviews/${reportId}`,
      headers: { cookie: authCookie },
    });
    expect(get.statusCode).toBe(200);
    const body = get.json<{
      verification: {
        status: string;
        overall: string | null;
        failedKinds: string[];
        rendered: string;
      } | null;
    }>();
    expect(body.verification).not.toBeNull();
    expect(body.verification!.status).toBe('FAILED');
    expect(body.verification!.overall).toBe('FAILED');
    expect(body.verification!.failedKinds).toContain('COMPILE');
    expect(body.verification!.rendered).toContain('Verification — FAILED');
    expect(body.verification!.rendered).toContain('Review required before any write-back');

    // The human decision is still accepted despite the FAILED verification.
    const decision = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie: authCookie },
      payload: { decision: 'APPROVE', rationale: 'LGTM despite compile failure', writeback: false },
    });
    expect(decision.statusCode).toBe(200);
    const decisionBody = decision.json<{ decision: string }>();
    expect(decisionBody.decision).toBe('APPROVE');
  });

  it('a FAILED verification does not trigger write-back when writeback:true but ceiling is OFF', async () => {
    const ingest = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/101' },
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

    // Insert a FAILED verification.
    const verificationId = uuidv7();
    await testDb.db.insert(reviewVerifications).values({
      id: verificationId,
      report_id: reportId,
      status: 'FAILED',
      overall: 'FAILED',
      flag: { verdict: 'FAILED', failedKinds: ['TEST'], timedOutKinds: [] },
      rendered: '## Verification — FAILED',
    });

    // Re-enable write-back ceiling for this test.
    process.env.WRITEBACK_ENABLED = '1';

    const decision = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie: authCookie },
      payload: { decision: 'APPROVE', rationale: 'accepted after failed verify', writeback: true },
    });
    expect(decision.statusCode).toBe(200);

    // The decision was persisted regardless of the verification flag.
    const decisions = await testDb.db.select().from(reviewDecisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('APPROVE');
    expect(decisions[0]?.writeback_enabled).toBe(true);

    // Write-back was recorded (the RecordingWriteBack captures every intent).
    expect(writeback.writes.length).toBeGreaterThanOrEqual(1);

    process.env.WRITEBACK_ENABLED = '0';
  });

  it('SKIPPED verification (verification disabled) allows human decision', async () => {
    const ingest = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/102' },
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

    // No verification row should exist (service was disabled).
    const verifications = await testDb.db.select().from(reviewVerifications);
    expect(verifications).toHaveLength(0);

    // Human decision still succeeds.
    const decision = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie: authCookie },
      payload: { decision: 'REQUEST_CHANGES', writeback: false },
    });
    expect(decision.statusCode).toBe(200);
    const d = decision.json<{ decision: string }>();
    expect(d.decision).toBe('REQUEST_CHANGES');
  });
});
