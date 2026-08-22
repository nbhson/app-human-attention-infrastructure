/**
 * Adaptive-threshold + inflation monitor tests (day-13 §3.5 acceptance).
 *
 * The pure rule ({@link decideThresholdChange}) is pinned against the whole
 * matrix — raise on high approval, lower on high rejection, no-op on a thin
 * window, and clamp to `[0.60, 0.80]` under repeated moves. The controller and
 * store are then exercised against a real (isolated) DB to prove the two things
 * that make the loop auditable: every move is append-only (`supersedes` chained)
 * and `revert` restores the prior value as a new row.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  ThresholdBand,
} from '@harness/domain';
import type {
  AssessmentID,
  AttentionInflationDetectedPayload,
  AttentionThresholdAdjustedPayload,
  ChangeID,
} from '@harness/domain';
import {
  agentRuns,
  artifacts,
  assessments,
  attentionThresholds,
  changes,
  decisions,
  projects,
  tasks,
} from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { InProcessEventBus } from '@harness/event-bus';

import {
  AdaptiveThresholdController,
  computeRates,
  decideThresholdChange,
  DEFAULT_ADAPTIVE,
} from '../thresholds/adaptive-threshold.js';
import type { AdaptiveConfig } from '../thresholds/adaptive-threshold.js';
import { ThresholdStore } from '../thresholds/threshold-store.js';
import { computeHighShare, InflationMonitor } from '../thresholds/inflation-monitor.js';

const SCHEMA = 'harness_test_adaptive_threshold';

/** A config for the HIGH band with overridable tuning knobs. */
function highConfig(overrides: Partial<AdaptiveConfig> = {}): AdaptiveConfig {
  return { projectId: 'proj', band: ThresholdBand.High, ...DEFAULT_ADAPTIVE, ...overrides };
}

describe('decideThresholdChange (pure rule)', () => {
  const config = highConfig();
  const approving = { decided: 10, approvalRate: 0.97, rejectionRate: 0.0 };
  const rejecting = { decided: 10, approvalRate: 0.4, rejectionRate: 0.5 };

  it('raises the cutoff one step when approval rate exceeds the bar', () => {
    const d = decideThresholdChange(0.6, approving, config);
    expect(d).not.toBeNull();
    expect(d!.before).toBe(0.6);
    expect(d!.after).toBeCloseTo(0.62, 6);
    expect(d!.reason).toContain('approval_rate');
  });

  it('lowers the cutoff one step when the rejection rate exceeds the bar', () => {
    const d = decideThresholdChange(0.7, rejecting, config);
    expect(d!.before).toBe(0.7);
    expect(d!.after).toBeCloseTo(0.68, 6);
    expect(d!.reason).toContain('rejection_rate');
  });

  it('no-ops below the minimum decision count (never adapt on noise)', () => {
    const thin = { decided: 3, approvalRate: 1.0, rejectionRate: 0.0 };
    expect(decideThresholdChange(0.6, thin, config)).toBeNull();
  });

  it('clamps 20 consecutive raises at the HIGH max (0.80)', () => {
    let current = 0.6;
    for (let i = 0; i < 20; i += 1) {
      const d = decideThresholdChange(current, approving, config);
      if (d) current = d.after;
    }
    expect(current).toBeCloseTo(0.8, 6);
  });

  it('clamps 20 consecutive lowers at the HIGH min (0.60)', () => {
    let current = 0.8;
    for (let i = 0; i < 20; i += 1) {
      const d = decideThresholdChange(current, rejecting, config);
      if (d) current = d.after;
    }
    expect(current).toBeCloseTo(0.6, 6);
  });

  it('does not move once pinned at a bound (above the ceiling is a no-op)', () => {
    expect(decideThresholdChange(0.8, approving, config)).toBeNull();
    expect(decideThresholdChange(0.6, rejecting, config)).toBeNull();
  });
});

describe('computeRates / computeHighShare', () => {
  it('computes approval and rejection shares over raw decisions', () => {
    const rates = computeRates(['APPROVED', 'APPROVED', 'REJECTED', 'REQUEST_CHANGES', 'APPROVED']);
    expect(rates.decided).toBe(5);
    expect(rates.approvalRate).toBeCloseTo(0.6, 6);
    expect(rates.rejectionRate).toBeCloseTo(0.4, 6);
  });

  it('computes the CRITICAL+HIGH share', () => {
    expect(computeHighShare(['CRITICAL', 'HIGH', 'LOW', 'MEDIUM'])).toBeCloseTo(0.5, 6);
    expect(computeHighShare([])).toBe(0);
    expect(computeHighShare(['LOW', 'LOW'])).toBe(0);
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
  await db.delete(attentionThresholds);
  await db.delete(decisions);
  await db.delete(assessments);
  await db.delete(changes);
  await db.delete(artifacts);
  await db.delete(agentRuns);
  await db.delete(tasks);
  await db.delete(projects);
});

interface Seed {
  readonly assessmentId: AssessmentID;
  readonly changeId: ChangeID;
}

/** Seed the FK chain and insert one assessment with `label`. */
async function seedAssessment(label: string): Promise<Seed> {
  const projectId = newProjectID();
  await db.insert(projects).values({ id: projectId, name: 'adaptive', repo_path: '/tmp/adaptive' });

  const taskId = newTaskID();
  await db.insert(tasks).values({
    id: taskId,
    project_id: projectId,
    title: 'adaptive',
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
    combined_priority: 0.5,
    label,
    factors_unavailable: [],
  });

  return { assessmentId, changeId };
}

/** Insert one human decision for an assessment (spends budget / drives rates). */
async function seedDecision(seed: Seed, decision: string): Promise<void> {
  await db.insert(decisions).values({
    id: newDecisionID(),
    change_id: seed.changeId,
    assessment_id: seed.assessmentId,
    decision,
    reviewer_id: 'reviewer-1',
  });
}

describe('ThresholdStore (append-only + revert)', () => {
  it('chains supersedes and restores the prior cutoff on revert', async () => {
    const store = new ThresholdStore(db);
    await store.apply('proj', {
      band: 'HIGH',
      cutoff: 0.62,
      minBounds: 0.6,
      maxBounds: 0.8,
      reason: 'first',
    });
    await store.apply('proj', {
      band: 'HIGH',
      cutoff: 0.64,
      minBounds: 0.6,
      maxBounds: 0.8,
      reason: 'second',
    });

    const active = await store.getActive('proj', 'HIGH');
    expect(active?.cutoff).toBe(0.64);

    const reverted = await store.revert('proj', 'HIGH');
    expect(reverted?.cutoff).toBe(0.62);

    const afterRevert = await store.getActive('proj', 'HIGH');
    expect(afterRevert?.cutoff).toBe(0.62);

    const history = await store.history('proj', 'HIGH');
    expect(history).toHaveLength(3);
    // Append-only: the revert is a *new* row, its `supersedes` points at the 0.64 row.
    expect(history[0]?.supersedes).toBeNull();
    expect(history[1]?.supersedes).toBe(history[0]?.id);
    expect(history[2]?.supersedes).toBe(history[1]?.id);
  });

  it('revert is a null no-op when there is no prior value', async () => {
    const store = new ThresholdStore(db);
    expect(await store.revert('proj', 'HIGH')).toBeNull();
  });
});

describe('AdaptiveThresholdController.run', () => {
  it('raises the HIGH cutoff one step and publishes before/after + persists a supersedes row', async () => {
    const bus = new InProcessEventBus();
    const adjusted: AttentionThresholdAdjustedPayload[] = [];
    bus.subscribe<AttentionThresholdAdjustedPayload>(
      EventType.AttentionThresholdAdjusted,
      (event) => adjusted.push(event.payload),
    );

    for (let i = 0; i < 6; i += 1) {
      const seed = await seedAssessment('HIGH');
      await seedDecision(seed, 'APPROVED');
    }

    const store = new ThresholdStore(db);
    const controller = new AdaptiveThresholdController(db, store, bus, highConfig());
    const result = await controller.run();

    expect(result).toMatchObject({ before: 0.6, after: 0.62 });
    expect(adjusted).toHaveLength(1);
    expect(adjusted[0]).toMatchObject({ band: 'HIGH', before: 0.6, after: 0.62 });
    expect(adjusted[0]!.reason).toContain('approval_rate');

    const history = await store.history('proj', 'HIGH');
    expect(history).toHaveLength(1);
    expect(history[0]?.supersedes).toBeNull();
    expect(history[0]?.cutoff).toBeCloseTo(0.62, 6);
  });

  it('no-ops (no event, no row) when the window is too small', async () => {
    const bus = new InProcessEventBus();
    const adjusted: AttentionThresholdAdjustedPayload[] = [];
    bus.subscribe<AttentionThresholdAdjustedPayload>(
      EventType.AttentionThresholdAdjusted,
      (event) => adjusted.push(event.payload),
    );

    // 2 decided items < minDecisions (5).
    for (let i = 0; i < 2; i += 1) {
      const seed = await seedAssessment('HIGH');
      await seedDecision(seed, 'APPROVED');
    }

    const store = new ThresholdStore(db);
    const controller = new AdaptiveThresholdController(db, store, bus, highConfig());
    await expect(controller.run()).resolves.toBeNull();
    expect(adjusted).toHaveLength(0);
    expect(await store.history('proj', 'HIGH')).toHaveLength(0);
  });
});

describe('InflationMonitor.run', () => {
  it('emits inflation_detected on a share breach and leaves thresholds untouched (alerts, never auto-lowers)', async () => {
    const bus = new InProcessEventBus();
    const inflated: AttentionInflationDetectedPayload[] = [];
    bus.subscribe<AttentionInflationDetectedPayload>(
      EventType.AttentionInflationDetected,
      (event) => inflated.push(event.payload),
    );

    // 4 highish of 5 total → share 0.8 > ceiling 0.3.
    await seedAssessment('CRITICAL');
    await seedAssessment('HIGH');
    await seedAssessment('HIGH');
    await seedAssessment('CRITICAL');
    await seedAssessment('LOW');

    const monitor = new InflationMonitor(db, bus, { windowDays: 7, ceiling: 0.3 });
    const result = await monitor.run();

    expect(result).not.toBeNull();
    expect(result!.share).toBeCloseTo(0.8, 6);
    expect(inflated).toHaveLength(1);
    expect(inflated[0]).toMatchObject({ ceiling: 0.3, window_days: 7 });

    // The monitor alerts; it must not have moved anything in the threshold store.
    const rows = await db.select().from(attentionThresholds);
    expect(rows).toHaveLength(0);
  });
});
