/**
 * Durable-bus tests (day-34 §3.5 acceptance).
 *
 * The thing under test is *not* a broker — it is that the `IEventBus` contract
 * is frozen across transports and that the at-least-once semantics the durable
 * path adds are exactly what idempotent consumers already assume:
 *
 * 1. Contract invariance: the same envelope, deep-equal (with `occurred_at`
 *    revived to a `Date`), comes back over `InProcessEventBus` and
 *    `RedisEventsBus` alike.
 * 2. At-least-once redelivery + idempotent-consumer dedupe: an unacked entry is
 *    redelivered; a handler keyed on `event_id` still processes it once.
 * 3. Dead-letter: a poison handler that always throws is dead-lettered after
 *    `maxDeliveryAttempts`, never wedging the loop.
 * 4. Reconnect/backoff: a transport that fails a few reads reports the outage and
 *    recovers (delivery still completes) with backoff sleeps.
 * 5. Transport selection: `resolveEventTransport` defaults to `inproc` and
 *    `buildEventBus('inproc')` is the zero-config path.
 */

import { describe, expect, it } from 'vitest';

import { EventType, Priority, newCorrelationID, newTaskID, newWorkflowID } from '@harness/domain';
import type { EventEnvelope, TaskCreatedPayload } from '@harness/domain';

import { InProcessEventBus } from '../in-process-event-bus.js';
import { createEvent } from '../create-event.js';
import { RedisEventsBus } from '../redis-events-bus.js';
import { InMemoryStreamTransport } from '../stream-transport.js';
import type { StreamEntry, StreamTransport } from '../stream-transport.js';
import { buildEventBus, resolveEventTransport } from '../transport-resolver.js';

function taskCreatedEvent(): EventEnvelope<TaskCreatedPayload> {
  return createEvent<TaskCreatedPayload>(EventType.TaskCreated, newCorrelationID(), {
    task_id: newTaskID(),
    workflow_id: newWorkflowID(),
    name: 'Fix login',
    priority: Priority.Medium,
  });
}

/** A store-backed transport whose first `failures` reads throw (connection down). */
class FlakyTransport implements StreamTransport {
  constructor(
    private readonly inner: StreamTransport,
    private failures: number,
  ) {}

  add(payload: string): Promise<string> {
    return this.inner.add(payload);
  }
  ack(entryId: string): Promise<void> {
    return this.inner.ack(entryId);
  }
  async readGroup(consumer: string, count: number): Promise<StreamEntry[]> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('connection down');
    }
    return this.inner.readGroup(consumer, count);
  }
}

describe('RedisEventsBus (day-34 §2–§3)', () => {
  it('round-trips the identical contract over inproc and durable (occurred_at revived)', async () => {
    const event = taskCreatedEvent();

    const inproc = new InProcessEventBus();
    const inprocSeen: EventEnvelope<unknown>[] = [];
    inproc.subscribe(EventType.TaskCreated, (e) => inprocSeen.push(e));
    inproc.publish(event);

    const store = new InMemoryStreamTransport();
    const durable = new RedisEventsBus(store, { pollIntervalMs: 0 });
    const durableSeen: EventEnvelope<unknown>[] = [];
    durable.subscribe(EventType.TaskCreated, (e) => durableSeen.push(e));
    durable.publish(event);
    await durable.drain();

    expect(durableSeen).toHaveLength(1);
    // Every field, including the `Date` `occurred_at`, equals the original.
    expect(durableSeen[0]).toEqual(inprocSeen[0]);
    expect(durableSeen[0]).toEqual(event);
    expect(durableSeen[0]?.occurred_at).toBeInstanceOf(Date);
  });

  it('redelivers an unacked entry at-least-once; an idempotent consumer still sees it once', async () => {
    const store = new InMemoryStreamTransport();
    const bus = new RedisEventsBus(store, { pollIntervalMs: 0 });

    const rawCalls: string[] = [];
    const seen = new Set<string>();
    let shouldFail = true; // first delivery crashes before ack; the redelivery succeeds
    bus.subscribe(EventType.TaskCreated, (e) => {
      rawCalls.push(e.event_id);
      if (shouldFail) {
        shouldFail = false;
        throw new Error('crash before ack');
      }
      seen.add(e.event_id);
    });

    bus.publish(taskCreatedEvent());
    await bus.drain();

    expect(rawCalls).toHaveLength(2); // at-least-once: delivered twice
    expect(seen.size).toBe(1); // idempotent: processed once
    expect(store.pendingCount).toBe(0); // the redelivery was finally acked
  });

  it('dead-letters a poison handler after maxDeliveryAttempts instead of looping forever', async () => {
    const store = new InMemoryStreamTransport();
    const deadLetters: Array<{ id: string; reason: string }> = [];
    const errors: Array<[string, unknown]> = [];
    const bus = new RedisEventsBus(store, {
      pollIntervalMs: 0,
      maxDeliveryAttempts: 2,
      onHandlerError: (eventType, error) => errors.push([eventType, error]),
      onDeadLetter: (entry, reason) => deadLetters.push({ id: entry.id, reason }),
    });

    let calls = 0;
    bus.subscribe(EventType.TaskCreated, () => {
      calls += 1;
      throw new Error('always down');
    });
    bus.publish(taskCreatedEvent());
    await bus.drain();

    expect(calls).toBe(2); // exactly maxDeliveryAttempts
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toContain('failed 2 delivery attempts');
    expect(store.pendingCount).toBe(0); // dead-lettered = removed from the pending set
  });

  it('reports a transport outage and recovers with backoff (reconnect, not silent drop)', async () => {
    const store = new InMemoryStreamTransport();
    const transport = new FlakyTransport(store, 2);
    const transportErrors: unknown[] = [];
    const sleeps: number[] = [];
    const bus = new RedisEventsBus(transport, {
      pollIntervalMs: 0,
      baseBackoffMs: 1,
      maxBackoffMs: 4,
      onTransportError: (error) => transportErrors.push(error),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const seen: string[] = [];
    bus.subscribe(EventType.TaskCreated, (e) => seen.push(e.event_id));
    bus.publish(taskCreatedEvent());
    await bus.drain();

    expect(transportErrors).toHaveLength(2); // the outage was surfaced, not swallowed
    expect(sleeps.length).toBeGreaterThanOrEqual(2); // backoff retries happened
    expect(seen).toHaveLength(1); // the event still delivered after recovery
    expect(store.pendingCount).toBe(0);
  });
});

describe('transport selection (day-34 §3.2)', () => {
  it('defaults to inproc for missing, empty, and inproc values', () => {
    expect(resolveEventTransport(undefined)).toBe('inproc');
    expect(resolveEventTransport(null)).toBe('inproc');
    expect(resolveEventTransport('')).toBe('inproc');
    expect(resolveEventTransport('  ')).toBe('inproc');
    expect(resolveEventTransport('inproc')).toBe('inproc');
  });

  it('maps redis/sqs and rejects unknown values', () => {
    expect(resolveEventTransport('redis')).toBe('redis');
    expect(resolveEventTransport('sqs')).toBe('sqs');
    expect(() => resolveEventTransport('nats')).toThrow(/unknown EVENT_TRANSPORT/);
  });

  it('builds the zero-config in-process bus for inproc', () => {
    const bus = buildEventBus('inproc');
    expect(bus).toBeInstanceOf(InProcessEventBus);
  });

  it('requires a transport adapter for redis/sqs, else it fails fast', () => {
    expect(() => buildEventBus('redis')).toThrow(/StreamTransport adapter/);
    expect(() => buildEventBus('sqs')).toThrow(/StreamTransport adapter/);

    const store = new InMemoryStreamTransport();
    expect(
      buildEventBus('redis', { transport: store, durable: { pollIntervalMs: 0 } }),
    ).toBeInstanceOf(RedisEventsBus);
    expect(
      buildEventBus('sqs', { transport: store, durable: { pollIntervalMs: 0 } }),
    ).toBeInstanceOf(RedisEventsBus);
  });
});
