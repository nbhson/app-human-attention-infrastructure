import { describe, expect, it, vi } from 'vitest';

import { EventType, Priority, newCorrelationID, newTaskID, newWorkflowID } from '@harness/domain';
import type { TaskCreatedPayload } from '@harness/domain';

import { InProcessEventBus } from '../in-process-event-bus.js';
import { createEvent } from '../create-event.js';

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function taskCreatedEvent(): ReturnType<typeof createEvent<TaskCreatedPayload>> {
  return createEvent<TaskCreatedPayload>(EventType.TaskCreated, newCorrelationID(), {
    task_id: newTaskID(),
    workflow_id: newWorkflowID(),
    name: 'Fix login',
    priority: Priority.Medium,
  });
}

describe('InProcessEventBus', () => {
  it('calls every handler subscribed to the event type', () => {
    const bus = new InProcessEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(EventType.TaskCreated, a);
    bus.subscribe(EventType.TaskCreated, b);

    const event = taskCreatedEvent();
    bus.publish(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('does not call handlers subscribed to a different event type', () => {
    const bus = new InProcessEventBus();
    const taskHandler = vi.fn();
    const artifactHandler = vi.fn();
    bus.subscribe(EventType.TaskCreated, taskHandler);
    bus.subscribe(EventType.ArtifactChanged, artifactHandler);

    bus.publish(taskCreatedEvent());

    expect(taskHandler).toHaveBeenCalledTimes(1);
    expect(artifactHandler).not.toHaveBeenCalled();
  });

  it('does not let a throwing handler prevent later handlers', () => {
    const errors: Array<[string, unknown]> = [];
    const bus = new InProcessEventBus((eventType, error) => {
      errors.push([eventType, error]);
    });
    const boom = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    bus.subscribe(EventType.TaskCreated, boom);
    bus.subscribe(EventType.TaskCreated, ok);

    bus.publish(taskCreatedEvent());

    expect(boom).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]![0]).toBe(EventType.TaskCreated);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(EventType.TaskCreated, handler);

    const event = taskCreatedEvent();
    bus.publish(event);
    unsubscribe();
    bus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('tracks subscriberCount across subscribe/unsubscribe', () => {
    const bus = new InProcessEventBus();
    expect(bus.subscriberCount(EventType.TaskCreated)).toBe(0);

    const a = bus.subscribe(EventType.TaskCreated, vi.fn());
    const b = bus.subscribe(EventType.TaskCreated, vi.fn());
    expect(bus.subscriberCount(EventType.TaskCreated)).toBe(2);

    a();
    expect(bus.subscriberCount(EventType.TaskCreated)).toBe(1);
    b();
    expect(bus.subscriberCount(EventType.TaskCreated)).toBe(0);
  });
});

describe('createEvent', () => {
  it('stamps every envelope field exactly', () => {
    const payload = { task_id: newTaskID() };
    const correlationId = newCorrelationID();

    const event = createEvent(EventType.TaskStateChanged, correlationId, payload);

    expect(event.event_id).toMatch(UUIDV7_RE);
    expect(event.event_type).toBe(EventType.TaskStateChanged);
    expect(event.event_version).toBe(1);
    expect(event.occurred_at).toBeInstanceOf(Date);
    expect(event.correlation_id).toBe(correlationId);
    expect(event.payload).toBe(payload);
  });

  it('uses a fresh UUIDv7 id, the current time, and version 1 by default', () => {
    const before = Date.now();
    const event = createEvent(EventType.TaskCreated, newCorrelationID(), {});
    const after = Date.now();

    expect(event.event_id).toMatch(UUIDV7_RE);
    expect(event.occurred_at.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.occurred_at.getTime()).toBeLessThanOrEqual(after);
    expect(event.event_version).toBe(1);
  });

  it('allows overriding the event version', () => {
    const event = createEvent(EventType.TaskCreated, newCorrelationID(), {}, 7);
    expect(event.event_version).toBe(7);
  });
});
