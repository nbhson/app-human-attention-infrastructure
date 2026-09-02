import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import {
  ArtifactStatus,
  ChangeStatus,
  EventType,
  FileChangeType,
  newAgentRunID,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newDecisionID,
  newProjectID,
  newTaskID,
  TaskStatus,
  uuidv7,
} from '@harness/domain';
import type {
  AssessmentID,
  AttentionItemDeferredPayload,
  AttentionItemRoutedPayload,
  ArtifactID,
  ChangeID,
  TaskID,
} from '@harness/domain';
import {
  agentRuns,
  artifacts,
  assessmentFeedback,
  assessments,
  changes,
  decisions,
  projects,
  reviewQueue,
  tasks,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { InProcessEventBus } from '@harness/event-bus';
import { register, routed } from '@harness/observability';

import { AttentionRouter } from '../router.js';
import { ATTENTION_POLICY_V1 } from '../policy.js';
import type { AttentionPolicy } from '../policy.js';

const SCHEMA = 'harness_test_attention_router';

interface Seed {
  readonly assessmentId: AssessmentID;
  readonly taskId: TaskID;
  readonly changeId: ChangeID;
  readonly artifactId: ArtifactID;
}

interface SeedAssessmentOptions {
  readonly label: string;
  readonly combinedPriority: number;
  readonly flaky?: boolean;
  readonly createdAt?: Date;
}

let testDb: TestDb;
let db: DrizzleDB;

/** Read the current value of a single-label counter series, by label. */
async function counterValue(name: string, labels: Record<string, string>): Promise<number> {
  const metric = register.getSingleMetric(name);
  const data = metric ? await metric.get() : undefined;
  const dp = data?.values.find((p) => Object.entries(labels).every(([k, v]) => p.labels[k] === v));
  return dp?.value ?? 0;
}

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  // Reset the routing counter in place (register.clear() would unregister the
  // module-level singleton and leave it orphaned for the rest of the file).
  routed.reset();

  await db.delete(reviewQueue);
  await db.delete(assessmentFeedback);
  await db.delete(verificationReports);
  await db.delete(decisions);
  await db.delete(assessments);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
});

/** Seed the FK chain and directly insert one assessment row. */
async function seedAssessment(options: SeedAssessmentOptions): Promise<Seed> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'router', repo_path: '/tmp/router' });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'router',
    state: TaskStatus.Executing,
    idempotency_key: `${taskId}:0`,
  });

  const runId = newAgentRunID();
  await db.insert(agentRuns).values({
    id: runId,
    task_id: taskId,
    attempt_number: 0,
    status: 'EXECUTING',
    max_steps: 10,
  });

  const artifactId = newArtifactID();
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/app.ts',
    status: ArtifactStatus.Draft,
  });

  const changeId = newChangeID();
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: runId,
    change_type: FileChangeType.Created,
    status: ChangeStatus.Pending,
    content_hash: 'hash',
    diff_summary: 'created src/app.ts',
  });

  await db.insert(verificationReports).values({
    id: uuidv7(),
    change_id: changeId,
    task_id: taskId,
    overall: 'PASSED',
    duration_ms: 10,
    flaky: options.flaky ?? false,
  });

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
    combined_priority: options.combinedPriority,
    label: options.label,
    factors_unavailable: [],
    ...(options.createdAt === undefined ? {} : { created_at: options.createdAt }),
  });

  return { assessmentId, taskId, changeId, artifactId };
}

describe('AttentionRouter.route', () => {
  it('routes CRITICAL → ESCALATE with an explainable queue row', async () => {
    const bus = new InProcessEventBus();
    const routed: AttentionItemRoutedPayload[] = [];
    bus.subscribe<AttentionItemRoutedPayload>(EventType.AttentionItemRouted, (event) => {
      routed.push(event.payload);
    });

    const { assessmentId, taskId } = await seedAssessment({
      label: 'CRITICAL',
      combinedPriority: 0.9,
    });

    const outcome = await new AttentionRouter(db, bus).route(assessmentId);
    expect(outcome).toMatchObject({ action: 'ESCALATE', ruleId: 'r1-critical', deferred: false });

    const rows = await db.select().from(reviewQueue);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task_id: taskId,
      assessment_id: assessmentId,
      action: 'ESCALATE',
      policy_version: 1,
      rule_id: 'r1-critical',
      position: 1,
      status: 'QUEUED',
    });
    expect(routed).toHaveLength(1);
    expect(routed[0]).toMatchObject({
      action: 'ESCALATE',
      rule_id: 'r1-critical',
      deferred: false,
    });

    // Day-04 routing metric: an ESCALATE routes to human review.
    expect(await counterValue('harness_routing_items_total', { route: 'human' })).toBe(1);
  });

  it('routes a flaky LOW → REVIEW_REQUIRED (r3 beats r5 by order)', async () => {
    const { assessmentId } = await seedAssessment({
      label: 'LOW',
      combinedPriority: 0.1,
      flaky: true,
    });

    const outcome = await new AttentionRouter(db, new InProcessEventBus()).route(assessmentId);
    expect(outcome).toMatchObject({
      action: 'REVIEW_REQUIRED',
      ruleId: 'r3-flaky',
      deferred: false,
    });
  });

  it('routes a clean LOW → AUTO_APPROVABLE, uncredited against the budget', async () => {
    const { assessmentId } = await seedAssessment({ label: 'LOW', combinedPriority: 0.1 });

    const outcome = await new AttentionRouter(db, new InProcessEventBus()).route(assessmentId);
    expect(outcome).toMatchObject({ action: 'AUTO_APPROVABLE', ruleId: 'r5-low', deferred: false });
  });

  it('returns null for an unknown assessment id', async () => {
    const outcome = await new AttentionRouter(db, new InProcessEventBus()).route(newAssessmentID());
    expect(outcome).toBeNull();
  });
});

describe('AttentionRouter §4.1 daily budget', () => {
  function budgetPolicy(dailyReviewBudget: number): AttentionPolicy {
    return {
      ...ATTENTION_POLICY_V1,
      fatigue: { ...ATTENTION_POLICY_V1.fatigue, dailyReviewBudget },
    };
  }

  it('defers MEDIUM items beyond the budget, stamps deferred_until + item_deferred, never defers ESCALATE', async () => {
    const bus = new InProcessEventBus();
    const deferred: AttentionItemDeferredPayload[] = [];
    bus.subscribe<AttentionItemDeferredPayload>(EventType.AttentionItemDeferred, (event) => {
      deferred.push(event.payload);
    });

    const router = new AttentionRouter(db, bus, budgetPolicy(1));

    // Spend the budget: one human decision today.
    const first = await seedAssessment({ label: 'MEDIUM', combinedPriority: 0.5 });
    await db.insert(decisions).values({
      id: newDecisionID(),
      change_id: first.changeId,
      assessment_id: first.assessmentId,
      decision: 'APPROVED',
      reviewer_id: 'reviewer-1',
    });

    // A subsequent MEDIUM is budget-deferred but still QUEUED (never dropped).
    const second = await seedAssessment({ label: 'MEDIUM', combinedPriority: 0.5 });
    const outcome = await router.route(second.assessmentId);
    expect(outcome).toMatchObject({ action: 'REVIEW_RECOMMENDED', deferred: true });

    const row = await db.select().from(reviewQueue).where(eq(reviewQueue.assessment_id, second.assessmentId));
    expect(row[0]?.status).toBe('QUEUED');
    expect(row[0]?.deferred_until).not.toBeNull();

    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toMatchObject({
      assessment_id: second.assessmentId,
      task_id: second.taskId,
    });
    expect(deferred[0]!.deferred_until).toBe(row[0]!.deferred_until!.toISOString());

    // CRITICAL bypasses the budget entirely.
    const critical = await seedAssessment({ label: 'CRITICAL', combinedPriority: 0.9 });
    const escalated = await router.route(critical.assessmentId);
    expect(escalated).toMatchObject({ action: 'ESCALATE', deferred: false });
  });

  it('reportAssessmentFeedback stores a usefulness verdict and optional comment', async () => {
    const router = new AttentionRouter(db, new InProcessEventBus());
    const { assessmentId } = await seedAssessment({ label: 'MEDIUM', combinedPriority: 0.5 });

    await router.reportAssessmentFeedback(assessmentId, false, 'barking up the wrong tree');

    const rows = await db.select().from(assessmentFeedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      assessment_id: assessmentId,
      was_useful: false,
      comment: 'barking up the wrong tree',
    });
  });
});
