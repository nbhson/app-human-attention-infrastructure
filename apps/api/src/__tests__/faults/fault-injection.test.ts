/**
 * Day-28 §2.2 F1 / F3 / F4 / F5 — fault injection.
 *
 * `FaultyDb` models a connection drop at the *head of the next matching query*,
 * throwing a queued error before delegating. That lets us prove the retry
 * invariants deterministically — no `setTimeout`, no real network failure:
 *
 *  - F1: an `update` that fails mid-transition leaves the task's state and audit
 *    trail untouched; the retry (no fault) succeeds and writes exactly one row.
 *  - F3: a throwing `EvidenceStore` makes `verify()` fail *after* building the
 *    report but *before* it commits, so `verification_reports` stays empty and
 *    `verification.completed` never publishes.
 *  - F4: the startup reconciler escorts orphaned EXECUTING/VERIFYING tasks to
 *    human attention (and leaves QUEUED alone), with a `task.orphan_recovered`
 *    event each.
 *  - F5: a dispatcher whose claim transaction dies leaves every task PENDING and
 *    dispatches nothing twice; a recovered dispatcher then dispatches each once.
 *
 * F2 (a slow step exceeding its timeout → TRANSIENT retry → `retry_log`, then
 * escalation) is already covered by `@harness/orchestrator`'s
 * `workflow-runner.test.ts` ("a step that exceeds its timeout is TRANSIENT").
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import {
  agentRuns,
  artifacts,
  changes,
  dispatchLog,
  evidence,
  evidenceLinks,
  projects,
  tasks,
  taskStateHistory,
  verificationCheckResults,
  verificationReports,
  verificationTestResults,
} from '@harness/db';
import { createTestDb, destroyTestDb, FaultyDb, type TestDb } from '@harness/db/test-utils';
import type { Logger } from '@harness/di';
import {
  brand,
  EventType,
  newAgentRunID,
  newArtifactID,
  newChangeID,
  newProjectID,
  newTaskID,
  TaskStatus,
} from '@harness/domain';
import type { ChangeID, TaskID, TaskOrphanRecoveredPayload } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import { Dispatcher, TaskService, TaskStateMachine } from '@harness/orchestrator';
import {
  CheckKind,
  CheckStatus,
  EvidenceStore,
  VerificationEngine,
} from '@harness/verification-engine';
import type { VerificationCheck } from '@harness/verification-engine';

import { reconcileOrphans } from '../../reconcile.js';

const SCHEMA = 'harness_test_faults';

let testDb: TestDb;

/** A logger that records nothing — the reconciler's only contract is "has warn". */
const logger: Logger = {
  warn: () => {},
  info: () => {},
  debug: () => {},
  error: () => {},
  child: () => logger,
} as unknown as Logger;

/** Seed a task in `state` (with its own project) and return its task id. */
async function seedTask(state: TaskStatus): Promise<TaskID> {
  const projectId = newProjectID();
  await testDb.db.insert(projects).values({ id: projectId, name: 'f', repo_path: '/tmp/f' });

  const taskId = newTaskID();
  await testDb.db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'f',
    state,
    idempotency_key: `${taskId}:0`,
  });
  return brand(taskId, 'TaskID');
}

async function getState(taskId: TaskID): Promise<string | undefined> {
  const rows = await testDb.db
    .select({ state: tasks.state })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  return rows[0]?.state;
}

/** Seed the full FK chain (`changes` ← `agent_runs` ← `tasks` ← `projects`) behind a change. */
async function seedChangeForVerification(): Promise<ChangeID> {
  const db = testDb.db;
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'v', repo_path: '/tmp/v' });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'v',
    state: TaskStatus.Executing,
    idempotency_key: `${taskId}:0`,
  });

  const runId = newAgentRunID();
  await db
    .insert(agentRuns)
    .values({ id: runId, task_id: taskId, status: 'EXECUTING', max_steps: 10 });

  const artifactId = newArtifactID();
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/index.ts',
    status: 'DRAFT',
  });

  const changeId = newChangeID();
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: runId,
    change_type: 'CREATED',
    status: 'PENDING',
    content_hash: 'h',
    diff_summary: 'new file',
  });

  return changeId;
}

const passingCheck: VerificationCheck = {
  kind: CheckKind.TEST,
  timeoutMs: 1_000,
  run: async () => ({
    checkKind: CheckKind.TEST,
    status: CheckStatus.PASSED,
    durationMs: 1,
    output: 'ok',
  }),
};

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // Truncate in FK order (children before parents).
  const db = testDb.db;
  await db.delete(evidenceLinks);
  await db.delete(evidence);
  await db.delete(verificationTestResults);
  await db.delete(verificationCheckResults);
  await db.delete(verificationReports);
  await db.delete(taskStateHistory);
  await db.delete(dispatchLog);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
});

describe('Day-28 F1 — dropped connection mid-transition', () => {
  it('leaves state and audit trail unchanged; the retry succeeds exactly once', async () => {
    const taskId = await seedTask(TaskStatus.Queued);

    const faulty = new FaultyDb(testDb.db);
    faulty.inject({ op: 'update', error: new Error('ECONNREFUSED: connection dropped') });

    const doomed = new TaskService(faulty.db, new InProcessEventBus(), new TaskStateMachine());
    await expect(
      doomed.transitionTask(taskId, TaskStatus.Executing, 'agent_runtime'),
    ).rejects.toThrow('ECONNREFUSED');

    // The failed UPDATE ran before any commit: state + history are untouched.
    expect(await getState(taskId)).toBe(TaskStatus.Queued);
    expect(await testDb.db.select().from(taskStateHistory)).toHaveLength(0);

    // Retry on the healthy connection succeeds and records one audit row.
    const recovered = new TaskService(testDb.db, new InProcessEventBus(), new TaskStateMachine());
    await recovered.transitionTask(taskId, TaskStatus.Executing, 'agent_runtime');
    expect(await getState(taskId)).toBe(TaskStatus.Executing);
    expect(await testDb.db.select().from(taskStateHistory)).toHaveLength(1);
  });
});

describe('Day-28 F3 — evidence write fails', () => {
  it('rolls back the whole report and never publishes', async () => {
    const changeId = await seedChangeForVerification();

    const bus = new InProcessEventBus();
    const published: unknown[] = [];
    bus.subscribe(EventType.VerificationCompleted, (event) => {
      published.push(event);
    });

    // The real EvidenceStore writes under the engine's transaction; this stand-in
    // fails on its first `record`, which must abort the whole `persist()`.
    const throwingStore = {
      record: async () => {
        throw new Error('evidence disk full');
      },
    } as unknown as EvidenceStore;

    const engine = new VerificationEngine(
      testDb.db,
      bus,
      { checks: [passingCheck] },
      throwingStore,
    );
    await expect(engine.verify(changeId)).rejects.toThrow('evidence disk full');

    // The transaction rolled back the report row, and publish is never reached.
    expect(await testDb.db.select().from(verificationReports)).toHaveLength(0);
    expect(await testDb.db.select().from(verificationCheckResults)).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});

describe('Day-28 F4 — startup orphan reconciler', () => {
  it('escorts EXECUTING/VERIFYING off in-flight states and leaves QUEUED alone', async () => {
    const executing = await seedTask(TaskStatus.Executing);
    const verifying = await seedTask(TaskStatus.Verifying);
    const queued = await seedTask(TaskStatus.Queued);

    const bus = new InProcessEventBus();
    const orphaned: TaskOrphanRecoveredPayload[] = [];
    bus.subscribe<TaskOrphanRecoveredPayload>(EventType.TaskOrphanRecovered, (event) => {
      orphaned.push(event.payload);
    });

    const taskService = new TaskService(testDb.db, bus, new TaskStateMachine());
    const recovered = await reconcileOrphans(testDb.db, taskService, bus, logger);

    expect(recovered).toBe(2);
    expect(await getState(executing)).toBe(TaskStatus.AwaitingHumanIntervention);
    expect(await getState(verifying)).toBe(TaskStatus.AwaitingHumanIntervention);
    expect(await getState(queued)).toBe(TaskStatus.Queued);

    expect(orphaned).toHaveLength(2);
    const taskIds = new Set(orphaned.map((p) => p.task_id));
    expect(taskIds.has(executing)).toBe(true);
    expect(taskIds.has(verifying)).toBe(true);
    for (const payload of orphaned) {
      expect(payload.reason).toBe('PROCESS_DIED');
      expect(payload.from_state !== TaskStatus.Queued).toBe(true);
    }

    const history = await testDb.db.select().from(taskStateHistory);
    expect(history).toHaveLength(2);
    for (const row of history) {
      expect(row.to_state).toBe(TaskStatus.AwaitingHumanIntervention);
    }
  });
});

describe('Day-28 F5 — dispatcher reservation dies, then recovers', () => {
  it('loses nothing and double-dispatches nothing', async () => {
    const taskIds = await Promise.all(
      Array.from({ length: 5 }, () => seedTask(TaskStatus.Pending)),
    );

    const faulty = new FaultyDb(testDb.db);
    faulty.inject({ op: 'transaction', error: new Error('connection terminated by admin') });

    const bus = new InProcessEventBus();
    const sm = new TaskStateMachine();
    const doomed = new Dispatcher(faulty.db, new TaskService(faulty.db, bus, sm), bus);
    await expect(doomed.dispatchPending(10)).rejects.toThrow('connection terminated');

    // The claim transaction died before any reservation or transition: nothing moved.
    for (const taskId of taskIds) {
      expect(await getState(taskId)).toBe(TaskStatus.Pending);
    }
    expect(await testDb.db.select().from(dispatchLog)).toHaveLength(0);

    // A recovered dispatcher (healthy connection) dispatches every task exactly once.
    const recovered = new Dispatcher(testDb.db, new TaskService(testDb.db, bus, sm), bus);
    const result = await recovered.dispatchPending(10);
    expect(result.dispatched).toBe(taskIds.length);
    expect(result.failed).toBe(0);

    for (const taskId of taskIds) {
      expect(await getState(taskId)).toBe(TaskStatus.Queued);
    }
    expect(await testDb.db.select().from(dispatchLog)).toHaveLength(taskIds.length);
  });
});
