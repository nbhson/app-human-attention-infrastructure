import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  brand,
  ChangeStatus,
  EventType,
  HumanDecisionType,
  newDecisionID,
  newReviewerID,
  newVerificationRequestID,
  newVerificationResultID,
  VerificationStatus,
} from '@harness/domain';
import type { ChangeID } from '@harness/domain';
import { agentRuns, artifacts, changes, projects, snapshots, tasks } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { createEvent, InProcessEventBus } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

import { ChangeStatusSubscriber } from '../change-status-subscriber.js';
import { insertChange, seedRun } from './helpers.js';

const SCHEMA = 'harness_test_change_status';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  await testDb.db.delete(snapshots);
  await testDb.db.delete(changes);
  await testDb.db.delete(artifacts);
  await testDb.db.delete(agentRuns);
  await testDb.db.delete(tasks);
  await testDb.db.delete(projects);
});

function newBus(): IEventBus {
  const bus = new InProcessEventBus();
  const subscriber = new ChangeStatusSubscriber(testDb.db);
  subscriber.subscribe(bus);
  return bus;
}

async function statusOf(changeId: ChangeID): Promise<string | undefined> {
  const rows = await testDb.db
    .select({ status: changes.status })
    .from(changes)
    .where(eq(changes.id, changeId))
    .limit(1);
  return rows[0]?.status;
}

/** Poll until the change's status matches (the subscriber handler is fire-and-forget). */
async function waitForStatus(changeId: ChangeID, expected: ChangeStatus): Promise<void> {
  const deadline = Date.now() + 3000;
  for (;;) {
    if ((await statusOf(changeId)) === expected) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('ChangeStatusSubscriber', () => {
  it('verification.completed (PASSED) moves PENDING → VERIFIED', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const bus = newBus();

    bus.publish(
      createEvent(EventType.VerificationCompleted, brand(changeId, 'CorrelationID'), {
        request_id: newVerificationRequestID(),
        change_id: changeId,
        result_id: newVerificationResultID(),
        status: VerificationStatus.Passed,
        check_summaries: ['compile ok'],
      }),
    );

    await waitForStatus(changeId, ChangeStatus.Verified);
  });

  it('verification.completed (FAILED) leaves the change PENDING', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const bus = newBus();

    bus.publish(
      createEvent(EventType.VerificationCompleted, brand(changeId, 'CorrelationID'), {
        request_id: newVerificationRequestID(),
        change_id: changeId,
        result_id: newVerificationResultID(),
        status: VerificationStatus.Failed,
        check_summaries: ['compile failed'],
      }),
    );

    // The handler returns early on non-PASSED, so nothing is written asynchronously.
    expect(await statusOf(changeId)).toBe(ChangeStatus.Pending);
  });

  it('review.decision_submitted moves VERIFIED → REVIEWED', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const bus = newBus();

    bus.publish(
      createEvent(EventType.VerificationCompleted, brand(changeId, 'CorrelationID'), {
        request_id: newVerificationRequestID(),
        change_id: changeId,
        result_id: newVerificationResultID(),
        status: VerificationStatus.Passed,
        check_summaries: [],
      }),
    );
    await waitForStatus(changeId, ChangeStatus.Verified);

    bus.publish(
      createEvent(EventType.DecisionSubmitted, brand(changeId, 'CorrelationID'), {
        decision_id: newDecisionID(),
        change_id: changeId,
        decision: HumanDecisionType.Approved,
        reviewer_id: newReviewerID(),
      }),
    );
    await waitForStatus(changeId, ChangeStatus.Reviewed);
  });

  it('guarded no-op: decision on a non-VERIFIED change does not overwrite it', async () => {
    const seed = await seedRun(testDb.db);
    const { changeId } = await insertChange(testDb.db, seed);
    const bus = newBus();

    bus.publish(
      createEvent(EventType.DecisionSubmitted, brand(changeId, 'CorrelationID'), {
        decision_id: newDecisionID(),
        change_id: changeId,
        decision: HumanDecisionType.Approved,
        reviewer_id: newReviewerID(),
      }),
    );

    // Decision without prior verification is outside the VERIFIED→REVIEWED window.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await statusOf(changeId)).toBe(ChangeStatus.Pending);
  });

  it('rollback_requested moves any state → ROLLED_BACK', async () => {
    const seed = await seedRun(testDb.db);
    const bus = newBus();

    // From PENDING.
    const pending = await insertChange(testDb.db, seed);
    bus.publish(
      createEvent(EventType.ArtifactRollbackRequested, brand(pending.changeId, 'CorrelationID'), {
        change_id: pending.changeId,
        reason: 'policy',
      }),
    );
    await waitForStatus(pending.changeId, ChangeStatus.RolledBack);

    // From VERIFIED.
    const verified = await insertChange(testDb.db, seed);
    bus.publish(
      createEvent(EventType.VerificationCompleted, brand(verified.changeId, 'CorrelationID'), {
        request_id: newVerificationRequestID(),
        change_id: verified.changeId,
        result_id: newVerificationResultID(),
        status: VerificationStatus.Passed,
        check_summaries: [],
      }),
    );
    await waitForStatus(verified.changeId, ChangeStatus.Verified);
    bus.publish(
      createEvent(EventType.ArtifactRollbackRequested, brand(verified.changeId, 'CorrelationID'), {
        change_id: verified.changeId,
        reason: 'human',
      }),
    );
    await waitForStatus(verified.changeId, ChangeStatus.RolledBack);

    // From REVIEWED.
    const reviewed = await insertChange(testDb.db, seed);
    bus.publish(
      createEvent(EventType.VerificationCompleted, brand(reviewed.changeId, 'CorrelationID'), {
        request_id: newVerificationRequestID(),
        change_id: reviewed.changeId,
        result_id: newVerificationResultID(),
        status: VerificationStatus.Passed,
        check_summaries: [],
      }),
    );
    await waitForStatus(reviewed.changeId, ChangeStatus.Verified);
    bus.publish(
      createEvent(EventType.DecisionSubmitted, brand(reviewed.changeId, 'CorrelationID'), {
        decision_id: newDecisionID(),
        change_id: reviewed.changeId,
        decision: HumanDecisionType.Approved,
        reviewer_id: newReviewerID(),
      }),
    );
    await waitForStatus(reviewed.changeId, ChangeStatus.Reviewed);
    bus.publish(
      createEvent(EventType.ArtifactRollbackRequested, brand(reviewed.changeId, 'CorrelationID'), {
        change_id: reviewed.changeId,
        reason: 'human',
      }),
    );
    await waitForStatus(reviewed.changeId, ChangeStatus.RolledBack);
  });
});
