import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { eq } from 'drizzle-orm';

import {
  HumanDecisionType,
  newAgentRunID,
  newArtifactID,
  newAssessmentID,
  newChangeID,
  newDecisionID,
  newProjectID,
  newReviewerID,
  newReviewQueueItemID,
  newTaskID,
  newUserID,
  ReviewQueueStatus,
  TaskStatus,
  uuidv7,
} from '@harness/domain';
import type {
  AssessmentID,
  ChangeID,
  DecisionSubmittedPayload,
  EscalationLeakagePayload,
  ReviewQueueItemID,
  TaskID,
} from '@harness/domain';
import {
  agentRuns,
  artifacts,
  assessments,
  autoApproveKillSwitch,
  calibrationDatasets,
  calibrationWeights,
  changes,
  decisions,
  projects,
  reviewQueue,
  tasks,
  users,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { EventType } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';

import { AutoApproveGate } from '../auto-approve/gate.js';
import type { CalibrationEvidence } from '../auto-approve/gate.js';
import { AutoApproveKillSwitch } from '../auto-approve/kill-switch.js';
import { AutoApproveSampler } from '../auto-approve/sampler.js';
import { AutoApproveExecutor, DbAutoApproveLoader } from '../auto-approve/executor.js';
import { ATTENTION_POLICY_V1 } from '../policy.js';
import type { AttentionPolicy } from '../policy.js';

const SCHEMA = 'harness_test_auto_approve';

/** A calibration fit whose fitted metrics beat the placeholder (gate part 1 green). */
const GREEN_CALIBRATION: CalibrationEvidence = {
  datasetId: 'ds-green',
  logLossFitted: 0.3,
  logLossPlaceholder: 0.5,
  rankingAccuracyFitted: 0.8,
  rankingAccuracyPlaceholder: 0.7,
};

const RED_CALIBRATION: CalibrationEvidence = {
  datasetId: 'ds-red',
  logLossFitted: 0.6, // worse than placeholder
  logLossPlaceholder: 0.5,
  rankingAccuracyFitted: 0.9,
  rankingAccuracyPlaceholder: 0.7,
};

function gate(): AutoApproveGate {
  return new AutoApproveGate({ maxRisk: 0.2, inflationCeiling: 0.3 });
}

describe('AutoApproveGate (day-14 §2.1)', () => {
  it('allows when calibration is green, the flag is on, and the item is under the bar', () => {
    const result = gate().evaluate({
      calibration: GREEN_CALIBRATION,
      inflationShare: 0.1,
      flagEnabled: true,
      combinedPriority: 0.1,
      alwaysReview: false,
    });
    expect(result).toEqual({ allowed: true });
  });

  it('blocks on a flipped flag with red calibration — evidence beats the flag', () => {
    const result = gate().evaluate({
      calibration: RED_CALIBRATION,
      inflationShare: 0.1,
      flagEnabled: true,
      combinedPriority: 0.1,
      alwaysReview: false,
    });
    expect(result).toEqual({ allowed: false, reason: 'calibration-red: log-loss not improved' });
  });

  it('blocks with no fitted weights (calibration-red even with the flag on)', () => {
    const result = gate().evaluate({
      calibration: null,
      inflationShare: 0.1,
      flagEnabled: true,
      combinedPriority: 0.1,
      alwaysReview: false,
    });
    expect(result).toEqual({ allowed: false, reason: 'calibration-red: no fitted weights' });
  });

  it('blocks when the flag is off even though calibration is green', () => {
    const result = gate().evaluate({
      calibration: GREEN_CALIBRATION,
      inflationShare: 0.1,
      flagEnabled: false,
      combinedPriority: 0.1,
      alwaysReview: false,
    });
    expect(result).toEqual({ allowed: false, reason: 'flag-off' });
  });

  it('blocks an item at or above the risk bar', () => {
    const result = gate().evaluate({
      calibration: GREEN_CALIBRATION,
      inflationShare: 0.1,
      flagEnabled: true,
      combinedPriority: 0.2, // >= maxRisk
      alwaysReview: false,
    });
    expect(result).toEqual({ allowed: false, reason: 'over-max-risk' });
  });

  it('blocks an ALWAYS_REVIEW path regardless of the above', () => {
    const result = gate().evaluate({
      calibration: GREEN_CALIBRATION,
      inflationShare: 0.1,
      flagEnabled: true,
      combinedPriority: 0.1,
      alwaysReview: true,
    });
    expect(result).toEqual({ allowed: false, reason: 'always-review' });
  });

  it('blocks on inflation above the ceiling (calibration part 2)', () => {
    const result = gate().evaluate({
      calibration: GREEN_CALIBRATION,
      inflationShare: 0.4, // > ceiling 0.3
      flagEnabled: true,
      combinedPriority: 0.1,
      alwaysReview: false,
    });
    expect(result).toEqual({ allowed: false, reason: 'calibration-red: inflation above ceiling' });
  });
});

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
  await db.delete(decisions);
  await db.delete(reviewQueue);
  await db.delete(assessments);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
  await db.delete(calibrationWeights);
  await db.delete(calibrationDatasets);

  // Reset the seeded singleton to live + flag-off so each test starts clean.
  await db.update(autoApproveKillSwitch).set({
    auto_approve_enabled: false,
    enabled: true,
    killed_at: null,
    killed_by: null,
    reason: null,
  });
});

interface Seed {
  readonly queueId: ReviewQueueItemID;
  readonly taskId: TaskID;
  readonly changeId: ChangeID;
  readonly assessmentId: AssessmentID;
}

/** Seed the FK chain + an assessment + an AUTO_APPROVABLE queue row (no calibration). */
async function seedAutoApprovable(options?: {
  readonly combinedPriority?: number;
  readonly action?: string;
}): Promise<Seed> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'auto', repo_path: '/tmp/auto' });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'auto-approve',
    state: TaskStatus.AwaitingReview,
    idempotency_key: `aa-${taskId}`,
  });

  const runId = newAgentRunID();
  await db.insert(agentRuns).values({
    id: runId,
    task_id: taskId,
    status: 'COMPLETED',
    max_steps: 10,
  });

  const artifactId = newArtifactID();
  await db.insert(artifacts).values({
    id: artifactId,
    project_id: projectId,
    file_path: 'src/a.ts',
    status: 'PENDING_REVIEW',
  });

  const changeId = newChangeID();
  await db.insert(changes).values({
    id: changeId,
    artifact_id: artifactId,
    agent_run_id: runId,
    change_type: 'CREATED',
    status: 'VERIFIED',
    content_hash: 'h',
    diff_summary: 'new file',
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
    combined_priority: options?.combinedPriority ?? 0.1,
    label: 'LOW',
    factors_unavailable: [],
  });

  const queueId = newReviewQueueItemID();
  await db.insert(reviewQueue).values({
    id: queueId,
    task_id: taskId,
    assessment_id: assessmentId,
    action: options?.action ?? 'AUTO_APPROVABLE',
    policy_version: 1,
    rule_id: 'r5-low',
    position: 1,
    status: ReviewQueueStatus.Queued,
  });

  return { queueId, taskId, changeId, assessmentId };
}

/** Insert a calibration dataset + a fitted weight row; returns the dataset id. */
async function seedCalibration(fit: CalibrationEvidence): Promise<void> {
  await db.insert(calibrationDatasets).values({
    id: fit.datasetId,
    label_source: 'feedback',
    row_count: 1,
    content_hash: 'h',
    source_version: 'v1',
    defect_lag_horizon: 'unbounded',
  });
  await db.insert(calibrationWeights).values({
    id: uuidv7(),
    dataset_id: fit.datasetId,
    method: 'logistic-regression-v0',
    weights: {},
    fit_config: {},
    log_loss_fitted: fit.logLossFitted,
    log_loss_placeholder: fit.logLossPlaceholder,
    ranking_accuracy_fitted: fit.rankingAccuracyFitted,
    ranking_accuracy_placeholder: fit.rankingAccuracyPlaceholder,
  });
}

/** Build a real executor over a policy; flag on, switch live, no sampling by default. */
function buildExecutor(input: {
  policy: AttentionPolicy;
  transitionSpy: ReturnType<typeof vi.fn>;
  bus: InProcessEventBus;
}): AutoApproveExecutor {
  const killSwitch = new AutoApproveKillSwitch(db);
  const sampler = new AutoApproveSampler(db, input.bus);
  return new AutoApproveExecutor({
    db,
    bus: input.bus,
    gate: gate(),
    killSwitch,
    sampler,
    taskTransition: { transitionTask: input.transitionSpy },
    policy: input.policy,
    loader: new DbAutoApproveLoader(db),
  });
}

function policyWithSampleRate(auditSampleRate: number): AttentionPolicy {
  return {
    ...ATTENTION_POLICY_V1,
    autoApprove: { ...ATTENTION_POLICY_V1.autoApprove, auditSampleRate },
  };
}

describe('AutoApproveExecutor (day-14 §3.3)', () => {
  it('approves a green item and writes the §2.4 record (NULL actor, AUTO_APPROVED, dataset)', async () => {
    const bus = new InProcessEventBus();
    const transitionSpy = vi.fn();
    const executor = buildExecutor({ policy: policyWithSampleRate(0), transitionSpy, bus });
    const killSwitch = new AutoApproveKillSwitch(db);

    await seedCalibration(GREEN_CALIBRATION);
    await killSwitch.setFlagEnabled(true);
    const { queueId, taskId } = await seedAutoApprovable();

    const outcome = await executor.execute(queueId);
    expect(outcome).toMatchObject({ approved: true, sampled: false });

    const rows = await db.select().from(decisions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision: HumanDecisionType.AutoApproved,
      actor_id: null,
      actor_email: null,
      sample: false,
      dataset_id: GREEN_CALIBRATION.datasetId,
    });

    // Drives the task state machine under the machine trigger, and the queue flips.
    expect(transitionSpy).toHaveBeenCalledWith(taskId, TaskStatus.Approved, 'auto_approve', expect.any(Object));
    const queue = await db.select().from(reviewQueue).where(eq(reviewQueue.id, queueId));
    expect(queue[0]?.status).toBe(ReviewQueueStatus.Decided);
  });

  it('denies with flag-off when calibration is green but the flag is off', async () => {
    const bus = new InProcessEventBus();
    const executor = buildExecutor({
      policy: policyWithSampleRate(0),
      transitionSpy: vi.fn(),
      bus,
    });

    await seedCalibration(GREEN_CALIBRATION);
    const { queueId } = await seedAutoApprovable(); // flag left off

    const outcome = await executor.execute(queueId);
    expect(outcome).toEqual({ approved: false, reason: 'flag-off' });
    expect(await db.select().from(decisions)).toHaveLength(0);
  });

  it('denies with calibration-red when the flag is on but no fit exists', async () => {
    const bus = new InProcessEventBus();
    const executor = buildExecutor({
      policy: policyWithSampleRate(0),
      transitionSpy: vi.fn(),
      bus,
    });
    const killSwitch = new AutoApproveKillSwitch(db);

    await killSwitch.setFlagEnabled(true);
    const { queueId } = await seedAutoApprovable(); // no calibration

    const outcome = await executor.execute(queueId);
    expect(outcome).toEqual({ approved: false, reason: 'calibration-red: no fitted weights' });
  });

  it('denies an ALWAYS_REVIEW item before the gate (action !== AUTO_APPROVABLE)', async () => {
    const bus = new InProcessEventBus();
    const executor = buildExecutor({
      policy: policyWithSampleRate(0),
      transitionSpy: vi.fn(),
      bus,
    });
    const killSwitch = new AutoApproveKillSwitch(db);

    await seedCalibration(GREEN_CALIBRATION);
    await killSwitch.setFlagEnabled(true);
    const { queueId } = await seedAutoApprovable({ action: 'REVIEW_REQUIRED' });

    const outcome = await executor.execute(queueId);
    expect(outcome).toEqual({ approved: false, reason: 'always-review' });
  });

  it('denies with kill-switch-tripped after the switch is killed', async () => {
    const bus = new InProcessEventBus();
    const executor = buildExecutor({
      policy: policyWithSampleRate(0),
      transitionSpy: vi.fn(),
      bus,
    });

    await seedCalibration(GREEN_CALIBRATION);
    const { queueId } = await seedAutoApprovable();
    // Kill via the DB row only (no requeue), so the queue row is still AUTO_APPROVABLE.
    await db.update(autoApproveKillSwitch).set({ enabled: false, reason: 'test kill' });

    const outcome = await executor.execute(queueId);
    expect(outcome).toEqual({ approved: false, reason: 'kill-switch-tripped' });
  });

  it('with audit_sample_rate=1.0, routes a silent control and records sample=true', async () => {
    const bus = new InProcessEventBus();
    const transitionSpy = vi.fn();
    const executor = buildExecutor({ policy: policyWithSampleRate(1.0), transitionSpy, bus });
    const killSwitch = new AutoApproveKillSwitch(db);

    await seedCalibration(GREEN_CALIBRATION);
    await killSwitch.setFlagEnabled(true);
    const { queueId, assessmentId } = await seedAutoApprovable();

    const outcome = await executor.execute(queueId);
    expect(outcome).toMatchObject({ approved: true, sampled: true });

    // The machine decision is recorded as sampled.
    const decision = (await db.select().from(decisions))[0];
    expect(decision?.sample).toBe(true);

    // A second, sampled control row was routed to a human.
    const controls = await db.select().from(reviewQueue).where(eq(reviewQueue.assessment_id, assessmentId));
    expect(controls).toHaveLength(2);
    const control = controls.find((row) => row.sampled);
    expect(control).toMatchObject({
      action: 'REVIEW_REQUIRED',
      sampled: true,
      status: ReviewQueueStatus.Queued,
    });
    expect(control?.rule_id).toBe('sampled-control');
  });
});

describe('AutoApproveKillSwitch (day-14 §2.2)', () => {
  it('one kill() flips the switch AND requeues in-flight AUTO_APPROVABLE items to human review', async () => {
    const killSwitch = new AutoApproveKillSwitch(db);
    const { queueId } = await seedAutoApprovable();
    const adminUser = newUserID();

    // actor FK: seed a minimal user so killed_by is a real reference.
    await db.insert(users).values({
      id: adminUser,
      oidc_sub: 'admin-sub',
      email: 'admin@example.com',
      display_name: 'Admin',
      roles: ['ADMIN'],
    });

    await killSwitch.kill(adminUser, 'calibration red flag');

    const state = await killSwitch.read();
    expect(state.killed).toBe(true);

    const row = (await db.select().from(reviewQueue).where(eq(reviewQueue.id, queueId)))[0];
    expect(row).toMatchObject({ action: 'REVIEW_REQUIRED', rule_id: 'kill-switch-requeue' });
  });

  it('isFlagEnabled reports the flag; a fresh row is off but live', async () => {
    const killSwitch = new AutoApproveKillSwitch(db);
    const before = await killSwitch.read();
    expect(before).toEqual({ flagEnabled: false, killed: false });
    await killSwitch.setFlagEnabled(true);
    expect(await killSwitch.isFlagEnabled()).toBe(true);
  });
});

describe('AutoApproveSampler (day-14 §2.3)', () => {
  it('shouldSample routes deterministically by rate', () => {
    const sampler = new AutoApproveSampler(db, new InProcessEventBus());
    expect(sampler.shouldSample(1.0, () => 0.999)).toBe(true);
    expect(sampler.shouldSample(0.0, () => 0)).toBe(false);
    expect(sampler.shouldSample(0.5, () => 0.4)).toBe(true);
    expect(sampler.shouldSample(0.5, () => 0.6)).toBe(false);
  });

  it('onRejected emits escalation_leakage for a sampled control', async () => {
    const bus = new InProcessEventBus();
    const sampler = new AutoApproveSampler(db, bus);
    const { changeId, assessmentId, taskId } = await seedAutoApprovable();

    // The silent control row (as routeToHuman would create it).
    await sampler.routeToHuman({
      taskId,
      assessmentId,
      changeId,
      policyVersion: 1,
    });

    const leaked: EscalationLeakagePayload[] = [];
    bus.subscribe<EscalationLeakagePayload>(EventType.EscalationLeakage, (event) => {
      leaked.push(event.payload);
    });

    const payload: DecisionSubmittedPayload = {
      decision_id: newDecisionID(),
      change_id: changeId,
      decision: HumanDecisionType.Rejected,
      reviewer_id: newReviewerID(),
      actor_id: newUserID(),
    };
    await sampler.onRejected(payload);

    expect(leaked).toHaveLength(1);
    expect(leaked[0]).toMatchObject({
      change_id: changeId,
      decision: HumanDecisionType.Rejected,
      sample: true,
    });
  });
});
