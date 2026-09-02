import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventType, newCorrelationID, newTaskID, TaskStatus } from '@harness/domain';
import { createEvent, InProcessEventBus } from '@harness/event-bus';

import { EventLogWriter } from './event-log-writer.js';
import { eventLog } from './schema/index.js';
import { createTestDb, destroyTestDb, type TestDb } from './__tests__/helpers.js';

const SCHEMA = 'harness_test_writer';
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

/** Poll until the event row appears or the deadline passes. */
async function waitForEvent(eventId: string): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const rows = await testDb.db.select().from(eventLog).where(eq(eventLog.event_id, eventId));
    if (rows.length > 0) return;
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('EventLogWriter', () => {
  it('write() persists an event', async () => {
    const writer = new EventLogWriter(testDb.db);
    const event = createEvent(EventType.TaskCreated, newCorrelationID(), { task_id: newTaskID() });

    await writer.write(event);

    const rows = await testDb.db.select().from(eventLog).where(eq(eventLog.event_id, event.event_id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe(EventType.TaskCreated);
  });

  it('duplicate write of the same event_id is a no-op', async () => {
    const writer = new EventLogWriter(testDb.db);
    const event = createEvent(EventType.TaskCreated, newCorrelationID(), { task_id: newTaskID() });

    await writer.write(event);
    await writer.write(event);

    const rows = await testDb.db.select().from(eventLog).where(eq(eventLog.event_id, event.event_id));
    expect(rows).toHaveLength(1);
  });

  it('subscribeTo() forwards published events into event_log', async () => {
    const writer = new EventLogWriter(testDb.db);
    const bus = new InProcessEventBus();
    writer.subscribeTo(bus);

    const event = createEvent(EventType.TaskStateChanged, newCorrelationID(), {
      task_id: newTaskID(),
      from_state: TaskStatus.Executing,
      to_state: TaskStatus.Verifying,
      triggered_by: 'test',
      attempt_number: 1,
    });

    bus.publish(event);

    await waitForEvent(event.event_id);
    const rows = await testDb.db.select().from(eventLog).where(eq(eventLog.event_id, event.event_id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe(EventType.TaskStateChanged);
  });
});
