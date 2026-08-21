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
  newProjectID,
  newTaskID,
  TaskStatus,
  uuidv7,
} from '@harness/domain';
import type {
  AssessmentID,
  AttentionInflationDetectedPayload,
  AttentionItemRoutedPayload,
  AttentionThresholdAdjustedPayload,
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
  projects,
  reviewQueue,
  tasks,
  verificationReports,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { InProcessEventBus } from '@harness/event-bus';

import {
  adjustHighThreshold,
  AttentionRouter,
  computeInflationRatio,
  startOfUtcDay,
} from '../router.js';
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

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await db.delete(reviewQueue);
  await db.delete(assessmentFeedback);
  await db.delete(verificationReports);
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

describe('fatigue pure helpers', () => {
  it('startOfUtcDay floors to the UTC midnight', () => {
    const day = startOfUtcDay(new Date('2026-08-20T23:59:59.999Z'));
    expect(day.toISOString()).toBe('2026-08-20T00:00:00.000Z');
  });

  it('adjustHighThreshold nudges +0.05 only past the 80% not-useful bar', () => {
    expect(adjustHighThreshold(0.6, 0.5)).toBe(0.6); // under bar — unchanged
    expect(adjustHighThreshold(0.6, 0.9)).toBeCloseTo(0.65, 6);
  });

  it('adjustHighThreshold is clamped to [0.60, 0.80]', () => {
    expect(adjustHighThreshold(0.79, 0.9)).toBeCloseTo(0.8, 6); // capped at max
    expect(adjustHighThreshold(0.5, 0.9)).toBeCloseTo(0.65, 6); // floored to min first
  });

  it('computeInflationRatio guards a zero previous week', () => {
    expect(computeInflationRatio(0.5, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(computeInflationRatio(0, 0)).toBe(1);
    expect(computeInflationRatio(0.3, 0.2)).toBeCloseTo(1.5, 6);
  });
});

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

describe('AttentionRouter §4.1 fatigue', () => {
  function smallBudgetPolicy(): AttentionPolicy {
    return {
      ...ATTENTION_POLICY_V1,
      fatigue: { ...ATTENTION_POLICY_V1.fatigue, dailyReviewBudget: 1 },
    };
  }

  it('defers RECOMMENDED once the budget is spent, but never defers ESCALATE', async () => {
    const bus = new InProcessEventBus();
    const router = new AttentionRouter(db, bus, smallBudgetPolicy());

    // Spend the budget: route a MEDIUM item, then mark it DECIDED.
    const first = await seedAssessment({ label: 'MEDIUM', combinedPriority: 0.5 });
    const firstOutcome = await router.route(first.assessmentId);
    expect(firstOutcome).not.toBeNull();
    await db
      .update(reviewQueue)
      .set({ status: 'DECIDED' })
      .where(eq(reviewQueue.id, firstOutcome!.queueId));

    // A second MEDIUM is budget-deferred but still enqueued (status QUEUED).
    const second = await seedAssessment({ label: 'MEDIUM', combinedPriority: 0.5 });
    const deferred = await router.route(second.assessmentId);
    expect(deferred).toMatchObject({ action: 'REVIEW_RECOMMENDED', deferred: true });

    const secondRow = await db
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.assessment_id, second.assessmentId));
    expect(secondRow[0]?.status).toBe('QUEUED');

    // ESCALATE bypasses the budget entirely.
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

  it('runThresholdAdjustment emits threshold_adjusted when HIGH items were mostly not useful', async () => {
    const bus = new InProcessEventBus();
    const adjusted: AttentionThresholdAdjustedPayload[] = [];
    bus.subscribe<AttentionThresholdAdjustedPayload>(
      EventType.AttentionThresholdAdjusted,
      (event) => {
        adjusted.push(event.payload);
      },
    );

    const router = new AttentionRouter(db, bus);
    const { assessmentId } = await seedAssessment({ label: 'HIGH', combinedPriority: 0.7 });
    await router.reportAssessmentFeedback(assessmentId, false);

    const result = await router.runThresholdAdjustment();

    expect(result).toEqual({ from: 0.6, to: 0.65 });
    expect(adjusted).toHaveLength(1);
    expect(adjusted[0]).toMatchObject({ label: 'HIGH', from: 0.6, to: 0.65 });
  });

  it('runThresholdAdjustment is silent when feedback is useful', async () => {
    const bus = new InProcessEventBus();
    const adjusted: AttentionThresholdAdjustedPayload[] = [];
    bus.subscribe<AttentionThresholdAdjustedPayload>(
      EventType.AttentionThresholdAdjusted,
      (event) => {
        adjusted.push(event.payload);
      },
    );

    const router = new AttentionRouter(db, bus);
    const { assessmentId } = await seedAssessment({ label: 'HIGH', combinedPriority: 0.7 });
    await router.reportAssessmentFeedback(assessmentId, true);

    await expect(router.runThresholdAdjustment()).resolves.toBeNull();
    expect(adjusted).toHaveLength(0);
  });

  it('runInflationCheck emits inflation_detected when this week out-prioritises last week', async () => {
    const bus = new InProcessEventBus();
    const inflated: AttentionInflationDetectedPayload[] = [];
    bus.subscribe<AttentionInflationDetectedPayload>(
      EventType.AttentionInflationDetected,
      (event) => {
        inflated.push(event.payload);
      },
    );

    // This week: one CRITICAL at 0.9. Last week: one LOW at 0.1 → ratio 9.
    await seedAssessment({ label: 'HIGH', combinedPriority: 0.9 });
    await seedAssessment({
      label: 'LOW',
      combinedPriority: 0.1,
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    const result = await new AttentionRouter(db, bus).runInflationCheck();

    expect(result).not.toBeNull();
    expect(result!.ratio).toBeGreaterThanOrEqual(9);
    expect(result!.alertRatio).toBe(1.5);
    expect(inflated).toHaveLength(1);
    expect(inflated[0]).toMatchObject({ alert_ratio: 1.5, window_days: 7 });
  });
});
