/**
 * Day-27 §2.2 acceptance: one task → one `correlation_id` everywhere.
 *
 * This test drives one task through every producer that writes a correlation id
 * and asserts the invariant end-to-end: across `event_log`, `agent_runs`,
 * `llm_call_log`, `verification_reports`, and `decisions`, every row for the
 * task carries `correlation_id === task.id` (the Phase-1 task lifecycle id).
 *
 * It is deliberately narrower than the happy-path E2E script (no filesystem, no
 * git): the agent uses a scripted `MockLLM` that ends immediately, verification
 * runs a trivial always-PASSED check, and the human decision is seeded straight
 * into the queue. What the E2E proves about the *causal chain*, this proves
 * about the *correlation invariant* — cheaply and without touching disk.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AgentRunner,
  LoggingLLMProvider,
  MockLLM,
  mockTextResponse,
  ToolAllowlist,
  ToolRegistry,
} from '@harness/agent-runtime';
import {
  agentRuns,
  artifacts,
  assessments,
  changes,
  decisions,
  eventLog,
  llmCallLog,
  projects,
  reviewQueue,
  tasks,
  users,
  verificationReports,
  EventLogWriter,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import {
  ArtifactStatus,
  brand,
  ChangeStatus,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newProjectID,
  newReviewQueueItemID,
  newUserID,
  ReviewQueueStatus,
  TaskStatus,
} from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import { TaskService, TaskStateMachine } from '@harness/orchestrator';
import { ReviewService } from '@harness/review';
import {
  CheckKind,
  CheckStatus,
  EvidenceStore,
  VerificationEngine,
} from '@harness/verification-engine';
import type { VerificationCheck } from '@harness/verification-engine';

const SCHEMA = 'harness_test_correlation';

/** A correlation-invariant-only verification check — no filesystem, always PASSED. */
const PASS_CHECK: VerificationCheck = {
  kind: CheckKind.COMPILE,
  timeoutMs: 1_000,
  run: async () => ({
    checkKind: CheckKind.COMPILE,
    status: CheckStatus.PASSED,
    durationMs: 1,
    output: 'ok',
  }),
};

let testDb: TestDb;
let db: DrizzleDB;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

/** Flush the fire-and-forget `EventLogWriter` by polling for a terminal event. */
async function waitForEvent(
  db_: DrizzleDB,
  eventType: string,
  correlationId: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await db_
      .select({ event_type: eventLog.event_type })
      .from(eventLog)
      .where(eq(eventLog.correlation_id, correlationId));
    if (rows.some((row) => row.event_type === eventType)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`timed out waiting for event "${eventType}"`);
}

describe('correlation-id propagation', () => {
  it('threads one task id through every correlated table', async () => {
    // --- Real plumbing: bus + event writer + state machine -------------------
    const bus = new InProcessEventBus();
    const writer = new EventLogWriter(db);
    writer.subscribeTo(bus);
    const taskService = new TaskService(db, bus, new TaskStateMachine());

    const projectId = newProjectID();
    await db.insert(projects).values({
      id: projectId,
      name: 'correlation',
      repo_path: '/tmp/correlation',
    });

    // 1. Create the task. `task.id` IS the correlation id for its lifecycle.
    const task = await taskService.createTask({
      projectId,
      title: 'propagate correlation id',
      description: 'write a file, verify, decide',
    });
    const taskId = task.id;
    await taskService.transitionTask(taskId, TaskStatus.Queued, 'orchestrator');

    // 2. Run the agent: log through the LLM decorator, correlate through the loop.
    const llm = new LoggingLLMProvider(new MockLLM([mockTextResponse('all done')]), db);

    // Never invokes a tool on this script (single `end_turn` response), so an
    // empty registry suffices.
    const tools = new ToolRegistry(new ToolAllowlist(new Set<string>()));
    const runner = new AgentRunner(
      db,
      bus,
      llm,
      tools,
      taskService,
      { runLinearWorkflow: async () => {} },
      10,
      50_000,
    );

    await runner.runTask(taskId);
    const runs = await db.select().from(agentRuns).where(eq(agentRuns.task_id, taskId));
    const runId = runs[0]?.id;
    if (!runId) {
      throw new Error('agent run was not created');
    }

    // 3. Verify a change that belongs to that run (trivial check → report row).
    const artifactId = newArtifactID();
    await db.insert(artifacts).values({
      id: artifactId,
      project_id: projectId,
      file_path: 'src/app.ts',
      status: ArtifactStatus.PendingReview,
    });
    const changeId = newChangeID();
    await db.insert(changes).values({
      id: changeId,
      artifact_id: artifactId,
      agent_run_id: runId,
      change_type: 'CREATED',
      status: ChangeStatus.Pending,
      content_hash: 'h1',
      diff_summary: 'created src/app.ts',
    });

    const engine = new VerificationEngine(db, bus, { checks: [PASS_CHECK] }, new EvidenceStore());
    await engine.verify(brand(changeId, 'ChangeID'));

    // 4. Route → claim → decide the task (the decide writes the decisions row).
    const assessmentId = newAssessmentID();
    await db.insert(assessments).values({
      id: assessmentId,
      artifact_id: artifactId,
      change_id: changeId,
      risk_score: 0.5,
      impact_score: 0.5,
      novelty_score: 0.5,
      complexity_score: 0.5,
      confidence_score: 0.5,
      combined_priority: 0.75,
      label: 'HIGH',
      factors_unavailable: [],
    });
    const queueItemId = newReviewQueueItemID();
    await db.insert(reviewQueue).values({
      id: queueItemId,
      task_id: taskId,
      assessment_id: assessmentId,
      action: 'REVIEW_REQUIRED',
      policy_version: 1,
      rule_id: 'rule-1',
      position: 0,
      status: ReviewQueueStatus.Claimed,
      claimed_by: 'reviewer-1',
    });

    // The decide drives APPROVE through the state machine, which expects the task
    // in AWAITING_REVIEW — set it directly (the verify step handler owns this
    // transition in the real workflow; here that graph is out of scope).
    await db.update(tasks).set({ state: TaskStatus.AwaitingReview }).where(eq(tasks.id, taskId));

    const review = new ReviewService(
      db,
      bus,
      {
        transitionTask: (id, toState, triggeredBy, opts) =>
          taskService.transitionTask(id, toState, triggeredBy, opts),
      },
      { reportAssessmentFeedback: async () => {} },
    );
    const actorId = newUserID();
    await db.insert(users).values({
      id: actorId,
      oidc_sub: `mock|${actorId}`,
      email: 'reviewer@example.com',
      display_name: 'Reviewer',
      roles: ['REVIEWER'],
    });
    await review.decide(brand(queueItemId, 'ReviewQueueItemID'), {
      decision: 'APPROVE',
      rationale: 'looks correct',
      wasUseful: true,
      reviewerId: brand('reviewer-1', 'ReviewerID'),
      actorId,
      actorEmail: 'reviewer@example.com',
    });

    // 5. Flush the fire-and-forget event writer, then assert the invariant.
    await waitForEvent(db, 'review.decision_submitted', taskId);

    const [events, calls, reports, decs, runs2] = await Promise.all([
      db.select({ cid: eventLog.correlation_id }).from(eventLog),
      db.select({ cid: llmCallLog.correlation_id }).from(llmCallLog),
      db.select({ cid: verificationReports.correlation_id }).from(verificationReports),
      db.select({ cid: decisions.correlation_id }).from(decisions),
      db.select({ cid: agentRuns.correlation_id }).from(agentRuns),
    ]);

    // Every table is populated and every row carries the SAME task id.
    expect(events.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(reports.length).toBeGreaterThan(0);
    expect(decs.length).toBeGreaterThan(0);
    expect(runs2.length).toBeGreaterThan(0);

    for (const row of [...events, ...calls, ...reports, ...decs, ...runs2]) {
      expect(row.cid).toBe(taskId);
    }
  });
});
