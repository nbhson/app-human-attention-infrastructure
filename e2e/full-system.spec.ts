/**
 * Full-system E2E (Phase 3 day-37 §2) — the golden path and the three branch
 * proofs, driven through the real object graph.
 *
 * Real internals: the DI container, the in-process event bus, `EventLogWriter`,
 * `ReviewIngestService`, `ReviewAgent`, `Judge` + `JudgeShadow`, `MemoryStore` +
 * `MemoryRetriever`, the verification flag machinery, and a real Postgres (via an
 * isolated schema). The substitutions are the declared stubs — the LLM, the
 * Git/ticket host seams, and the write-back service — plus the two fire-and-forget
 * background *writers* (memory ingest + verification), which are no-ops so they
 * cannot race the per-test table reset — and the `Db` token repointed
 * at the isolated schema (the same substitution the unit suites use).
 *
 * The LLM is a single `MockLLM` replaying one *dual-valid* JSON document: it
 * satisfies the review parser (`summary`/`overallVerdict`/`findings`/`suggestions`)
 * and the judge parser (`severityAgreement`/…/`reasoning`) at once, so the review
 * and its fire-and-forget judge shadow stay deterministic regardless of the order
 * the async LLM calls resolve in.
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
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb } from '@harness/db/test-utils';
import type { TestDb } from '@harness/db/test-utils';
import {
  EventType,
  GitProviderType,
  MemoryKind,
  PullRequestFileStatus,
  Role,
  TicketProviderType,
  newEvidenceID,
  newUserID,
} from '@harness/domain';
import type {
  Issue,
  MemoryProvider,
  PullRequest,
  WriteBackIntent,
  WriteBackResult,
} from '@harness/domain';
import type { CloneResult, FetchPullRequestInput, GitProvider } from '@harness/git-provider';
import type { FetchIssueInput, TicketProvider } from '@harness/ticket-provider';
import type { WriteBackService } from '@harness/writeback';
import { MemoryStore } from '@harness/memory';
import { CheckKind, CheckStatus, flagReport, renderFlag } from '@harness/verification-engine';
import type { CheckResult } from '@harness/verification-engine';

import { buildApp } from '../apps/api/src/app.js';
import { buildContainer, bootContainer } from '../apps/api/src/bootstrap.js';
import { writebackEnabled } from '../apps/api/src/writeback-gate.js';

const SCHEMA = 'e2e_full_system';
const SUB = 'mock|e2e-reviewer';
const USER_ID = newUserID();

/** One response valid for *both* the review parser and the judge parser. */
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

/** A 64-entry script is far more than the handful of review+judge calls we make. */
function dualValidScript(): ReturnType<typeof mockTextResponse>[] {
  return Array.from({ length: 64 }, () => mockTextResponse(DUAL_VALID));
}

/** A stubbed Git host seam: echoes the requested repo/number back as a PR. */
class FakeGitProvider implements GitProvider {
  readonly requests: FetchPullRequestInput[] = [];

  async fetchPullRequest(input: FetchPullRequestInput): Promise<PullRequest> {
    this.requests.push(input);
    return {
      provider: GitProviderType.GitHub,
      number: input.number,
      title: `Pull request ${input.number}`,
      description: 'A stubbed PR for the e2e golden path.',
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
          additions: 3,
          deletions: 1,
          patch: '@@ -1,3 +1,3 @@\n- return a * b;\n+ return a * b; // see review',
        },
      ],
    };
  }

  async postComment(): Promise<void> {
    throw new Error('FakeGitProvider.postComment must not be exercised in e2e');
  }

  async setStatus(): Promise<void> {
    throw new Error('FakeGitProvider.setStatus must not be exercised in e2e');
  }

  async cloneAndCheckout(): Promise<CloneResult> {
    throw new Error('FakeGitProvider.cloneAndCheckout must not be exercised in e2e');
  }
}

/** A stubbed Jira seam: echoes the requested key back as a requirement issue. */
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
    throw new Error('FakeTicketProvider.postComment must not be exercised in e2e');
  }

  async transition(): Promise<void> {
    throw new Error('FakeTicketProvider.transition must not be exercised in e2e');
  }
}

/** Records any write it is asked to make — the OFF test asserts it stays empty. */
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
let ticket: FakeTicketProvider;
let writeback: RecordingWriteBack;
let authCookie = '';
let sandboxRoot: string;
let savedSandboxRoot: string | undefined;
let savedWritebackEnabled: string | undefined;
let savedWritebackGithub: string | undefined;
let savedMcpConfig: string | undefined;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);

  // The MCP registry resolves `mcp.config.json` (git-ignored, environment-
  // specific). A developer's local copy can declare servers whose `tokenEnv`
  // (GITHUB_TOKEN, …) isn't set, which makes the registry throw at resolve
  // time and fail this suite before a single test runs. Point it at a missing
  // path so the app-under-test resolves a deterministic, empty registry here,
  // just as the local CI runner does (no `mcp.config.json` in CI).
  savedMcpConfig = process.env.MCP_CONFIG_PATH;
  process.env.MCP_CONFIG_PATH = '/nonexistent/mcp.config.json';

  // Point the sandbox root at a throwaway temp dir so the suite can later prove
  // the read-only review slice never writes a file into it (day-37 §3.2).
  savedSandboxRoot = process.env.SANDBOX_ROOT;
  sandboxRoot = mkdtempSync(join(tmpdir(), 'harness-e2e-sandbox-'));
  process.env.SANDBOX_ROOT = sandboxRoot;

  // Force the write-back ceiling OFF (WRITEBACK_ENABLED=0) so the run is
  // deterministic under the now-on-by-default gate — only an explicit opt-out
  // defeats an APPROVE write, regardless of a developer's shell.
  savedWritebackEnabled = process.env.WRITEBACK_ENABLED;
  savedWritebackGithub = process.env.WRITEBACK_GITHUB;
  process.env.WRITEBACK_ENABLED = '0';
  delete process.env.WRITEBACK_GITHUB;

  container = buildContainer();
  container.register(TOKENS.Db, () => testDb.db);
  container.register(TOKENS.LLMProvider, () => new MockLLM(dualValidScript()));
  git = new FakeGitProvider();
  ticket = new FakeTicketProvider();
  writeback = new RecordingWriteBack();
  // These replace the env-driven providers BEFORE the first resolve, so the
  // graph never reaches for a live token or the real LLM.
  container.register(TOKENS.GitProvider, () => git);
  container.register(TOKENS.TicketProvider, () => ticket);
  container.register(TOKENS.WriteBackService, () => writeback);
  // Replace the env-driven OIDC provider with the mock AFTER `buildContainer`
  // so login resolves a deterministic principal (a REVIEWER) instead of needing
  // `OIDC_MOCK` in the caller's shell.
  container.register(
    TOKENS.OidcProvider,
    () => new MockOidcProvider({ sub: SUB, email: 'reviewer@example.com', name: 'E2E Reviewer' }),
  );
  // The fire-and-forget background writers (memory ingest + verification) race
  // `resetReviewTables`, which drops their tables mid-write and surfaces a stray
  // FK (memory_entry_evidence → evidence, review_verifications → review_reports).
  // Neither is the subject of this suite — the memory round-trip is tested against
  // `MemoryStore`/`MemoryRetriever` directly below, and the verification flag math
  // against `flagReport`/`renderFlag` — so substitute both with no-ops to keep the
  // reset deterministic.
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
  if (savedSandboxRoot === undefined) {
    delete process.env.SANDBOX_ROOT;
  } else {
    process.env.SANDBOX_ROOT = savedSandboxRoot;
  }
  if (savedWritebackEnabled === undefined) {
    delete process.env.WRITEBACK_ENABLED;
  } else {
    process.env.WRITEBACK_ENABLED = savedWritebackEnabled;
  }
  if (savedWritebackGithub === undefined) {
    delete process.env.WRITEBACK_GITHUB;
  } else {
    process.env.WRITEBACK_GITHUB = savedWritebackGithub;
  }
  if (savedMcpConfig === undefined) {
    delete process.env.MCP_CONFIG_PATH;
  } else {
    process.env.MCP_CONFIG_PATH = savedMcpConfig;
  }
});

/** Reset every table the review slice touches, in FK order, before each test. */
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

describe('full-system E2E (day-37)', () => {
  it('golden path: ingest → report → judge shadow → no decision mutation', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);

    const reply = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/42' },
    });
    expect(reply.statusCode).toBe(202);
    const created = reply.json<{ reportId: string }>();
    expect(created.reportId).toBeDefined();

    // Wait for the async review to finish before asserting report details.
    await waitForCount(async () => {
      const rows = await db.select().from(reviewReports);
      return rows.filter((r) => r.id === created.reportId && r.review_status === 'complete').length;
    }, 1);

    // The stubbed Git seam was hit at least once (the async worker may call it
    // again during processReview). We assert >= 1 to be resilient to that.
    expect(git.requests.length).toBeGreaterThanOrEqual(1);
    expect(git.requests[0]?.number).toBe(42);

    // The report is readable back over HTTP with its findings + suggestions.
    const get = await app.inject({
      method: 'GET',
      url: `/api/reviews/${created.reportId}`,
      headers: { cookie: authCookie },
    });
    expect(get.statusCode).toBe(200);
    const report = get.json<{
      overallVerdict: string;
      findings: Array<{ file: string; severity: string }>;
      suggestions: Array<{ file: string }>;
    }>();
    expect(report.overallVerdict).toBe('APPROVE');
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.file).toBe('src/calc.ts');
    expect(report.findings[0]?.severity).toBe('MAJOR');
    expect(report.suggestions).toHaveLength(1);

    // The correlation audit trail persisted through the real event bus.
    await waitForCount(async () => {
      const rows = await db.select().from(eventLog);
      return rows.filter((row) => row.event_type === EventType.ReviewReportCreated).length;
    }, 1);

    // The judge shadow ran (real Judge + JudgeShadow + LLM stub) and recorded a run.
    await waitForCount(async () => {
      const rows = await db.select().from(judgeRuns);
      return rows.length;
    }, 1);
    const runs = await db.select().from(judgeRuns);
    expect(runs[0]?.severity_agreement).toBeCloseTo(0.9);
    expect(runs[0]?.routing_agreement).toBeCloseTo(0.85);
    expect(runs[0]?.evidence_sufficiency).toBeCloseTo(0.8);

    // Shadow-only: the judge scored the report but mutated neither the report
    // nor any decision — "HOLD" means measurement recorded, no authority.
    const reportRows = await db.select().from(reviewReports);
    expect(reportRows).toHaveLength(1);
    expect(reportRows[0]?.overall_verdict).toBe('APPROVE');
    const decisions = await db.select().from(reviewDecisions);
    expect(decisions).toHaveLength(0);
  });

  it('verification branch: a FAILED check flags the report and never auto-rejects', () => {
    const compilePassed: CheckResult = {
      checkKind: CheckKind.COMPILE,
      status: CheckStatus.PASSED,
      durationMs: 812,
      output: 'tsc --noEmit … 0 errors',
    };
    const testFailed: CheckResult = {
      checkKind: CheckKind.TEST,
      status: CheckStatus.FAILED,
      exitCode: 1,
      durationMs: 1240,
      evidenceId: 'evidence:sha256:6f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c',
      output: 'FAIL src/calc.test.ts > calc…\nAssertionError: expected 30 to be 12',
    };

    const flag = flagReport([compilePassed, testFailed]);
    expect(flag.failed).toBe(true);
    expect(flag.verdict).toBe('FAILED');
    expect(flag.failedKinds).toEqual(['TEST']);
    // Non-blocking: the flag is a report, not authority — no decision field.
    expect('decision' in flag).toBe(false);

    const markdown = renderFlag(flag);
    expect(markdown).toContain('## Verification — FAILED');
    expect(markdown).toContain('evidence:');
    expect(markdown).toContain('**Review required before any write-back.**');
  });

  it('write-back disabled (WRITEBACK_ENABLED=0): an APPROVE (writeback:true) writes nothing external', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);

    // The gate now defaults ON, so an explicit `0` is the only opt-out; the rest
    // of the three-layer contract is unchanged.
    expect(writebackEnabled(true)).toBe(false); // process.env has WRITEBACK_ENABLED='0'
    expect(writebackEnabled(true, {})).toBe(true); // unset ⇒ ON by default
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: '1' })).toBe(true);
    expect(writebackEnabled(true, { WRITEBACK_ENABLED: 'true' })).toBe(true);
    expect(writebackEnabled(undefined, { WRITEBACK_ENABLED: '1' })).toBe(false);

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/43' },
    });
    const { reportId } = ingest.json<{ reportId: string }>();

    const decision = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie: authCookie },
      payload: { decision: 'APPROVE', rationale: 'LGTM', writeback: true },
    });
    expect(decision.statusCode).toBe(200);
    const body = decision.json<{ decision: string; writeback: false }>();
    expect(body.decision).toBe('APPROVE');
    expect(body.writeback).toBe(false);

    // "Nothing external" is an auditable fact, not an absence: the decision row
    // records the OFF toggle and neither the write-back service nor the audit
    // log was touched.
    const decisions = await db.select().from(reviewDecisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.writeback_enabled).toBe(false);
    expect(writeback.writes).toHaveLength(0);
    const logs = await db.select().from(writebackLog);
    expect(logs).toHaveLength(0);
  });

  it('REQUEST_CHANGES never writes, even when the request asks for it', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/44' },
    });
    const { reportId } = ingest.json<{ reportId: string }>();

    const decision = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reportId}/decision`,
      headers: { cookie: authCookie },
      payload: { decision: 'REQUEST_CHANGES', writeback: true },
    });
    expect(decision.statusCode).toBe(200);
    const body = decision.json<{ writeback: { emitted: number; reason: string } }>();
    expect(body.writeback.emitted).toBe(0);
    expect(body.writeback.reason).toContain('REQUEST_CHANGES');

    expect(writeback.writes).toHaveLength(0);
    const logs = await db.select().from(writebackLog);
    expect(logs).toHaveLength(0);
  });

  it('golden path with a Jira requirement ticket reaches the ticket seam', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);

    const reply = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: authCookie },
      payload: { prUrl: 'https://github.com/acme/api/pull/7', jiraTicket: 'ACME-42' },
    });
    expect(reply.statusCode).toBe(202);
    const { reportId } = reply.json<{ reportId: string }>();

    // Wait for the async review to finish before checking ticket seam.
    await waitForCount(async () => {
      const rows = await db.select().from(reviewReports);
      return rows.filter((r) => r.id === reportId && r.review_status === 'complete').length;
    }, 1);

    expect(ticket.requests).toHaveLength(1);
    expect(ticket.requests[0]?.key).toBe('ACME-42');
  });

  it('memory: write → read round-trip with evidence provenance', async () => {
    const db = container.resolve<DrizzleDB>(TOKENS.Db);

    const evidenceId = newEvidenceID();
    await db.insert(evidence).values({
      id: evidenceId,
      content_hash: 'sha256:deadbeef',
      kind: 'HUMAN_NOTE',
      body: 'A human noted a recurring overflow pattern.',
    });

    const store = container.resolve<MemoryStore>(TOKENS.MemoryStore);
    const entry = await store.create({
      kind: MemoryKind.FINDING,
      content: 'recurring integer overflow in arithmetic helpers',
      sourceEvidence: [evidenceId],
      confidence: 80,
    });
    expect(entry.kind).toBe(MemoryKind.FINDING);

    const links = await db.select().from(memoryEntryEvidence);
    const matching = links.filter((link) => link.memory_entry_id === entry.id);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.evidence_id).toBe(evidenceId);

    const retriever = container.resolve<MemoryProvider>(TOKENS.MemoryProvider);
    const results = await retriever.retrieve({
      text: 'integer overflow arithmetic',
      kinds: [MemoryKind.FINDING],
    });
    expect(results.some((result) => result.entry.id === entry.id)).toBe(true);
  });
});
