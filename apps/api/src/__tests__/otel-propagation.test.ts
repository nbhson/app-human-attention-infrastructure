/**
 * Day-03 §3.4 acceptance — trace_id ↔ correlation_id propagation end-to-end.
 *
 * Drives the network (_real_ ReviewService over a real test DB + bus) so the
 * instrumented seams actually fire:
 *
 *  1. `review.decide` — bound with `ctx = <task_id>` — produces a *root* span (no
 *     ambient HTTP parent) whose finish write-throughs a `trace_correlation` row
 *     mapping task → trace. A support query can start from the task and find the
 *     trace (the reverse of HTTP, where you start from the trace to find the task).
 *  2. The Fastify `http.request` hook mints its own request correlation, wraps a
 *     handler that opens a child span: a *single* trace carries the request's
 *     correlation id AND its child's — a trace is a join (§2.4 caveat) — and only
 *     the root span write-throughs.
 */

import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  agentRuns,
  artifacts,
  assessments,
  changes,
  decisions,
  projects,
  reviewQueue,
  tasks,
  traceCorrelation,
  users,
} from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import {
  brand,
  newAgentRunID,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newProjectID,
  newReviewQueueItemID,
  newTaskID,
  newUserID,
  ReviewQueueStatus,
  Role,
  TaskStatus,
} from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import { ReviewService, type DecisionInput } from '@harness/review';
import { initTracing, inMemoryExporter, resetTracing, withSpan } from '@harness/observability';

import { registerTraceHook } from '../trace.js';

const SCHEMA = 'harness_test_otel_prop';
const REVIEWER_SUB = 'mock|otel-reviewer';
const REVIEWER_EMAIL = 'otel-reviewer@example.com';
const REVIEWER_USER_ID = newUserID();

let testDb: TestDb;
let service: ReviewService;
const transitionSpy = vi.fn();
const reportSpy = vi.fn();

function dbWriteThrough(row: {
  readonly trace_id: string;
  readonly span_id: string;
  readonly correlation_id: string;
}): void {
  // Fire-and-forget, mirroring apps/api/src/observability.ts exactly — the
  // failure is swallowed (a transient reject must become a logged-and-dropped
  // line, never an unhandled rejection that flakes the test run).
  void testDb.db
    .insert(traceCorrelation)
    .values(row)
    .onConflictDoNothing()
    .catch(() => {
      /* a failed trace write never breaks the test under test */
    });
}

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  service = new ReviewService(
    testDb.db,
    new InProcessEventBus(),
    { transitionTask: transitionSpy } as never,
    { reportAssessmentFeedback: reportSpy } as never,
  );
  // The tracer provider is global and worker-shared across test files, so reset
  // it first: guarantee THIS file owns the active provider + its write-through
  // even when a sibling test file ran initTracing in this worker first.
  resetTracing();
  initTracing({ writeThrough: dbWriteThrough });
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  transitionSpy.mockReset();
  reportSpy.mockReset();
  inMemoryExporter().reset();

  // Truncate in FK order (children before parents; users/sessions last).
  await testDb.db.delete(decisions); // decisions.actor_id FKs users
  await testDb.db.delete(traceCorrelation);
  await testDb.db.delete(reviewQueue);
  await testDb.db.delete(assessments);
  await testDb.db.delete(changes);
  await testDb.db.delete(artifacts);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
  await testDb.db.delete(users);
});

/** Seed a CLAIMED review item + its supporting rows; returns task + queue ids. */
async function seedClaimedItem(): Promise<{ taskId: string; queueId: string }> {
  const db = testDb.db;
  const projectId = newProjectID();
  const taskId = newTaskID();
  const agentRunId = newAgentRunID();
  const artifactId = newArtifactID();
  const changeId = newChangeID();
  const assessmentId = newAssessmentID();
  const queueId = newReviewQueueItemID();

  await db.insert(projects).values({ id: projectId, name: 'p', repo_path: '/tmp/p' });
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'Instrument me',
    state: TaskStatus.AwaitingReview,
    idempotency_key: `ik-${taskId}`,
  });
  await db.insert(agentRuns).values({ id: agentRunId, task_id: taskId, status: 'COMPLETED', max_steps: 10 });
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/index.ts',
    status: 'PENDING_REVIEW',
  });
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: agentRunId,
    change_type: 'CREATED',
    status: 'VERIFIED',
    content_hash: 'h',
    diff_summary: 'new file',
  });
  await db.insert(assessments).values({
    id: assessmentId,
    artifact_id: artifactId,
    change_id: changeId,
    risk_score: 0.5,
    impact_score: 0.5,
    novelty_score: 0.5,
    complexity_score: 0.5,
    confidence_score: 0.5,
    combined_priority: 0.6,
    label: 'HIGH',
    factors_unavailable: [],
  });
  await db.insert(reviewQueue).values({
    id: queueId,
    task_id: taskId,
    assessment_id: assessmentId,
    action: 'REVIEW_REQUIRED',
    policy_version: 1,
    rule_id: 'r1',
    position: 1,
    status: ReviewQueueStatus.Claimed,
  });
  await db.insert(users).values({
    id: REVIEWER_USER_ID,
    oidc_sub: REVIEWER_SUB,
    email: REVIEWER_EMAIL,
    display_name: 'OTel Rev',
    roles: [Role.Reviewer],
  });

  return { taskId, queueId };
}

/** Wait (fire-and-forget writer, busy DB under the full suite) until `op` is satisfied. */
async function eventually(op: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10000;
  for (;;) {
    if (await op()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for trace_correlation row');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The decide payload; reviewer/actor come from the seeded user + sub. */
function decideInput(decision: 'APPROVE' | 'REJECT'): DecisionInput {
  return {
    decision,
    rationale: 'LGTM',
    wasUseful: true,
    reviewerId: brand(REVIEWER_SUB, 'ReviewerID'),
    actorId: brand(REVIEWER_USER_ID, 'UserID'),
    actorEmail: REVIEWER_EMAIL,
  };
}

describe('trace_id ↔ correlation_id propagation (day-03 §3.4)', () => {
  it('review.decide binds task correlation into a root span + a mapping row', async () => {
    const { taskId, queueId } = await seedClaimedItem();

    await service.decide(queueId as never, decideInput('APPROVE'));

    // The span carries the task as its correlation attribute.
    const span = inMemoryExporter()
      .getFinishedSpans()
      .find((s) => s.name === 'review.decide');
    expect(span?.attributes['harness.correlation_id']).toBe(taskId);

    // No ambient HTTP parent → root span → it write-throughs a mapping row
    // whose trace_id matches the span's own.
    expect(span?.parentSpanId).toBeUndefined();
    await eventually(async () => {
      const rows = await testDb.db.select().from(traceCorrelation).where(eq(traceCorrelation.correlation_id, taskId));
      return rows.length > 0;
    });
    const row = await testDb.db.select().from(traceCorrelation).where(eq(traceCorrelation.correlation_id, taskId));
    expect(row[0]!.trace_id).toBe(span!.spanContext().traceId);
  });

  it('http.request wraps handler child spans in one trace; only the root writes through', async () => {
    const app = Fastify({ logger: false });
    registerTraceHook(app);
    app.get('/span', async () => {
      await withSpan({ spanName: 'handler.child' }, async () => {
        // child reads the request's ambient correlation; no ctx override
      });
      return { ok: true };
    });

    const res = await app.inject({ method: 'GET', url: '/span' });
    expect(res.statusCode).toBe(200);

    const root = inMemoryExporter()
      .getFinishedSpans()
      .find((s) => s.name === 'http.request');
    const child = inMemoryExporter()
      .getFinishedSpans()
      .find((s) => s.name === 'handler.child');

    expect(root).toBeDefined();
    expect(child).toBeDefined();
    // A single trace: the child descends from the request root.
    expect(child!.spanContext().traceId).toBe(root!.spanContext().traceId);
    expect(child!.parentSpanId).toBe(root!.spanContext().spanId);

    // The child carries the *request's* correlation id (ambient), not its own.
    expect(child!.attributes['harness.correlation_id']).toBe(root!.attributes['harness.correlation_id']);

    // Only the root http.request wrote a mapping row; child spans never do.
    const requestCorrelation = root!.attributes['harness.correlation_id'] as string;
    await eventually(async () => {
      const rows = await testDb.db
        .select()
        .from(traceCorrelation)
        .where(eq(traceCorrelation.correlation_id, requestCorrelation));
      return rows.length === 1;
    });
  });
});
