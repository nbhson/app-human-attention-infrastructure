import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EventType,
  newAgentRunID,
  newArtifactID,
  newChangeID,
  newProjectID,
  newTaskID,
  uuidv7,
} from '@harness/domain';
import type { ChangeID, VerificationCompletedPayload } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import {
  agentRuns,
  artifacts,
  changes,
  evidence,
  evidenceLinks,
  projects,
  tasks,
  verificationCheckResults,
  verificationReports,
  verificationTestResults,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';

import { CompileCheck } from '../checks/compile-check.js';
import { EvidenceStore } from '../evidence-store.js';
import { VerificationEngine } from '../verification-engine.js';
import { CheckKind, CheckStatus } from '../types.js';
import type { CheckResult, VerificationCheck } from '../types.js';

const SCHEMA = 'harness_test_verification_engine';
const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));

let testDb: TestDb;
let db: DrizzleDB;
let bus: InProcessEventBus;
let completed: VerificationCompletedPayload[];

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

beforeEach(async () => {
  bus = new InProcessEventBus();
  completed = [];
  bus.subscribe<VerificationCompletedPayload>(EventType.VerificationCompleted, (event) => {
    completed.push(event.payload);
  });

  await db.delete(verificationTestResults);
  await db.delete(verificationCheckResults);
  await db.delete(verificationReports);
  await db.delete(evidenceLinks);
  await db.delete(evidence);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

/** Seed the join chain the engine resolves: project → task → agent_run → artifact → change. */
async function seedChange(repoPath: string): Promise<ChangeID> {
  const projectId = newProjectID();
  const taskId = newTaskID();
  const runId = newAgentRunID();
  const artifactId = newArtifactID();
  const changeId = newChangeID();

  await db.insert(projects).values({ id: projectId, name: 've', repo_path: repoPath });
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 've',
    state: 'EXECUTING',
    idempotency_key: uuidv7(),
  });
  await db.insert(agentRuns).values({
    id: runId,
    task_id: taskId,
    attempt_number: 0,
    status: 'EXECUTING',
    max_steps: 10,
  });
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/index.ts',
    status: 'DRAFT',
  });
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: runId,
    change_type: 'CREATED',
    status: 'PENDING',
    content_hash: 'x',
    diff_summary: 'seed',
  });
  return changeId;
}

/** A check that never settles on its own — used to exercise the two timeout levels. */
function hangingCheck(kind: CheckKind, timeoutMs: number): VerificationCheck {
  return {
    kind,
    timeoutMs,
    run: () => new Promise<CheckResult>(() => {}),
  };
}

describe('VerificationEngine', () => {
  it('persists a PASSED report and publishes verification.completed', async () => {
    const changeId = await seedChange(`${FIXTURES}/compile-pass`);
    const engine = new VerificationEngine(
      db,
      bus,
      { checks: [new CompileCheck(60_000)] },
      new EvidenceStore(),
    );

    const report = await engine.verify(changeId);

    expect(report.changeId).toBe(changeId);
    expect(report.overall).toBe('PASSED');
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ checkKind: 'COMPILE', status: 'PASSED' });
    expect(report.failedChecks).toEqual([]);

    const reportRows = await db.select().from(verificationReports);
    expect(reportRows).toHaveLength(1);
    expect(reportRows[0]).toMatchObject({ id: report.id, change_id: changeId, overall: 'PASSED' });

    const checkRows = await db.select().from(verificationCheckResults);
    expect(checkRows).toHaveLength(1);
    expect(checkRows[0]).toMatchObject({
      report_id: report.id,
      check_kind: 'COMPILE',
      status: 'PASSED',
    });

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      change_id: changeId,
      result_id: report.id,
      status: 'PASSED',
      check_summaries: ['COMPILE: PASSED'],
    });
  });

  it('fails a broken change and lists failedChecks in the report and event', async () => {
    const changeId = await seedChange(`${FIXTURES}/compile-fail`);
    const engine = new VerificationEngine(
      db,
      bus,
      { checks: [new CompileCheck(60_000)] },
      new EvidenceStore(),
    );

    const report = await engine.verify(changeId);

    expect(report.overall).toBe('FAILED');
    expect(report.checks[0]?.status).toBe(CheckStatus.FAILED);
    expect(report.failedChecks).toEqual([CheckKind.COMPILE]);
    expect(completed[0]?.status).toBe('FAILED');
  });

  it('records TIMED_OUT when a single check exceeds its own budget', async () => {
    const changeId = await seedChange(`${FIXTURES}/compile-pass`);
    const engine = new VerificationEngine(
      db,
      bus,
      {
        checks: [hangingCheck(CheckKind.TEST, 20)],
        requestTimeoutMs: 5_000,
      },
      new EvidenceStore(),
    );

    const report = await engine.verify(changeId);

    expect(report.overall).toBe('FAILED');
    expect(report.failedChecks).toEqual([CheckKind.TEST]);
    expect(report.checks[0]).toMatchObject({ checkKind: 'TEST', status: CheckStatus.TIMED_OUT });
    expect(report.checks[0]?.output).toContain('check timed out: TEST');
  });

  it('records every check TIMED_OUT when the request budget elapses first', async () => {
    const changeId = await seedChange(`${FIXTURES}/compile-pass`);
    const engine = new VerificationEngine(
      db,
      bus,
      {
        checks: [hangingCheck(CheckKind.COMPILE, 100), hangingCheck(CheckKind.LINT, 100)],
        requestTimeoutMs: 20,
      },
      new EvidenceStore(),
    );

    const report = await engine.verify(changeId);

    expect(report.overall).toBe('FAILED');
    expect(report.checks).toHaveLength(2);
    expect(report.checks.every((check) => check.status === CheckStatus.TIMED_OUT)).toBe(true);
    expect(report.checks[0]?.output).toContain('verification request timed out');
  });

  it('persists check results for a TIMED_OUT verification too', async () => {
    const changeId = await seedChange(`${FIXTURES}/compile-pass`);
    const engine = new VerificationEngine(
      db,
      bus,
      {
        checks: [hangingCheck(CheckKind.TEST, 20)],
        requestTimeoutMs: 5_000,
      },
      new EvidenceStore(),
    );

    const report = await engine.verify(changeId);

    const checkRows = await db.select().from(verificationCheckResults);
    expect(checkRows).toHaveLength(1);
    expect(checkRows[0]).toMatchObject({
      report_id: report.id,
      check_kind: 'TEST',
      status: 'TIMED_OUT',
    });
  });

  it('reports FLAKY as passed-but-flagged and persists per-test rows (was_retried)', async () => {
    const changeId = await seedChange(`${FIXTURES}/compile-pass`);
    const flakyCheck: VerificationCheck = {
      kind: CheckKind.TEST,
      timeoutMs: 60_000,
      run: async () => ({
        checkKind: CheckKind.TEST,
        status: CheckStatus.FLAKY,
        durationMs: 42,
        output: '1 failed, retried ok',
        testResults: [
          { testFile: 'a.test.ts', testName: 'a > flaky', status: 'PASSED', durationMs: 5 },
          {
            testFile: 'a.test.ts',
            testName: 'a > still fails',
            status: 'FAILED',
            durationMs: 7,
            error: 'boom',
          },
        ],
        retried: true,
      }),
    };
    const engine = new VerificationEngine(db, bus, { checks: [flakyCheck] }, new EvidenceStore());

    const report = await engine.verify(changeId);

    expect(report.overall).toBe('PASSED');
    expect(report.flaky).toBe(true);
    expect(report.failedChecks).toEqual([]);
    expect(completed[0]?.status).toBe('PASSED');

    const reportRows = await db.select().from(verificationReports);
    expect(reportRows[0]?.flaky).toBe(true);

    const checkRows = await db.select().from(verificationCheckResults);
    expect(checkRows).toHaveLength(1);
    expect(checkRows[0]?.status).toBe('FLAKY');

    const testRows = await db.select().from(verificationTestResults);
    expect(testRows).toHaveLength(2);
    expect(testRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check_result_id: checkRows[0]?.id,
          test_name: 'a > flaky',
          status: 'PASSED',
          was_retried: true,
        }),
        expect.objectContaining({
          check_result_id: checkRows[0]?.id,
          test_name: 'a > still fails',
          status: 'FAILED',
          error: 'boom',
          was_retried: true,
        }),
      ]),
    );
  });

  it('persists CHECK_OUTPUT evidence linked to every check result', async () => {
    const changeId = await seedChange(`${FIXTURES}/compile-pass`);
    const engine = new VerificationEngine(
      db,
      bus,
      { checks: [new CompileCheck(60_000)] },
      new EvidenceStore(),
    );

    const report = await engine.verify(changeId);
    expect(report.overall).toBe('PASSED');

    const checkRows = await db.select().from(verificationCheckResults);
    expect(checkRows).toHaveLength(1);
    const evidenceId = checkRows[0]?.evidence_id;
    expect(evidenceId).toBeTruthy();

    const evidenceRows = await db.select().from(evidence);
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]).toMatchObject({ id: evidenceId, kind: 'CHECK_OUTPUT' });

    const links = await db.select().from(evidenceLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      evidence_id: evidenceId,
      subject_kind: 'check_result',
      subject_id: checkRows[0]?.id,
    });
  });

  it('stores the full evidence body even when the inline output is capped', async () => {
    const changeId = await seedChange(`${FIXTURES}/compile-pass`);
    const full = 'a'.repeat(70 * 1024 + 1); // just over the 64 KB inline cap
    const capped = `${'b'.repeat(100)}\n...[truncated]`;
    const check: VerificationCheck = {
      kind: CheckKind.COMPILE,
      timeoutMs: 60_000,
      run: async () => ({
        checkKind: CheckKind.COMPILE,
        status: CheckStatus.PASSED,
        durationMs: 1,
        output: capped,
        evidenceBody: full,
      }),
    };
    const engine = new VerificationEngine(db, bus, { checks: [check] }, new EvidenceStore());
    await engine.verify(changeId);

    const checkRows = await db.select().from(verificationCheckResults);
    expect(checkRows[0]?.output).toBe(capped);

    const evidenceRows = await db.select().from(evidence);
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]?.body).toBe(full);
    expect(evidenceRows[0]?.body.length).toBe(full.length);
    expect(evidenceRows[0]?.body.length).toBeGreaterThan(64 * 1024);
  });

  it('stores a TEST_RESULTS evidence blob when a TEST check carries per-test leaves', async () => {
    const changeId = await seedChange(`${FIXTURES}/compile-pass`);
    const testCheck: VerificationCheck = {
      kind: CheckKind.TEST,
      timeoutMs: 60_000,
      run: async () => ({
        checkKind: CheckKind.TEST,
        status: CheckStatus.PASSED,
        durationMs: 5,
        output: '1 passed',
        testResults: [
          { testFile: 'a.test.ts', testName: 'a > ok', status: 'PASSED', durationMs: 1 },
        ],
      }),
    };
    const engine = new VerificationEngine(db, bus, { checks: [testCheck] }, new EvidenceStore());
    await engine.verify(changeId);

    const evidenceRows = await db.select().from(evidence);
    const kinds = evidenceRows.map((row) => row.kind).sort();
    expect(kinds).toEqual(['CHECK_OUTPUT', 'TEST_RESULTS']);

    const testResultsRow = evidenceRows.find((row) => row.kind === 'TEST_RESULTS');
    expect(testResultsRow?.body).toContain('a > ok');
  });
});
