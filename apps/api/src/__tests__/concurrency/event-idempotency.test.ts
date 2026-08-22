/**
 * Day-28 C6 — event idempotency.
 *
 * The `EventLogWriter` persists every bus event to the append-only `event_log`,
 * whose `event_id` is a PRIMARY KEY. Re-publishing the *same* envelope (same
 * `event_id`) is therefore a silent, idempotent no-op at the storage layer —
 * exactly one row survives, even when both writes race.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { eventLog, EventLogWriter } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { brand, EventType, newTaskID } from '@harness/domain';
import { createEvent, InProcessEventBus } from '@harness/event-bus';

const SCHEMA = 'harness_test_concurrency_event';

let testDb: TestDb;

/** Poll a predicate until it returns true or the deadline passes. */
async function waitFor(pred: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

describe('Day-28 C6 — event idempotency', () => {
  it('publishing the same event_id twice persists exactly one event_log row', async () => {
    const bus = new InProcessEventBus();
    const writer = new EventLogWriter(testDb.db);
    writer.subscribeTo(bus);

    const taskId = newTaskID();
    const event = createEvent(EventType.TaskFailed, brand(taskId, 'CorrelationID'), {
      task_id: taskId,
      reason: 'TEST',
    });

    // Fire-and-forget publish ×2: the two writes race, but `event_id` is a primary
    // key so `onConflictDoNothing` collapses them to one durable row.
    bus.publish(event);
    bus.publish(event);

    await waitFor(
      async () =>
        (await testDb.db.select().from(eventLog).where(eq(eventLog.event_id, event.event_id)))
          .length === 1,
      5_000,
      'event_log dedup',
    );

    // Give any stray write a beat, then assert it never grew past one.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const rows = await testDb.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.event_id, event.event_id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.correlation_id).toBe(taskId);
    expect(rows[0]?.event_type).toBe(EventType.TaskFailed);
  });
});
