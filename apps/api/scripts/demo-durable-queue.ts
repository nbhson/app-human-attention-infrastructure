/**
 * Durable-queue demo (Phase 3 day-34 §3.3, §5) — `pnpm demo:durable-queue`.
 *
 * Shows the optional durable transport behind the *same* `IEventBus` contract:
 * the default in-process bus swaps to a `RedisEventsBus` over an
 * `InMemoryStreamTransport` (Redis Streams semantics — the in-repo stand-in; a
 * production deployment injects a real `StreamTransport` adapter, so no broker SDK
 * ships here and the repo stays Redis-free).
 *
 * The four scenes prove the day-34 acceptance:
 *   1. Publish a backlog to the durable stream — events land in the broker, no consumer yet.
 *   2. worker-1 boots, drains a *partial* batch (2 of 5), then "crashes" before the rest.
 *   3. worker-2 boots (a restart) and drains the remaining 3 — **nothing is lost**.
 *   4. A redelivery scene: a handler that "crashes" once before ack proves an
 *      unacked entry comes back, and an idempotent consumer keyed on `event_id` dedupes.
 *
 * Delivery is at-least-once; correctness under redelivery is inherited from the
 * idempotent consumers (Days 08/19) — the durable bus only adds crash-safety.
 */

import { EventType, Priority, newCorrelationID, newTaskID, newWorkflowID } from '@harness/domain';
import type { EventEnvelope, TaskCreatedPayload } from '@harness/domain';
import { InMemoryStreamTransport, RedisEventsBus, createEvent } from '@harness/event-bus';

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`[demo:durable-queue] assertion failed: ${label}`);
  }
}

function makeEvent(name: string): EventEnvelope<TaskCreatedPayload> {
  return createEvent<TaskCreatedPayload>(EventType.TaskCreated, newCorrelationID(), {
    task_id: newTaskID(),
    workflow_id: newWorkflowID(),
    name,
    priority: Priority.Medium,
  });
}

async function main(): Promise<void> {
  console.log();
  console.log('demo:durable-queue — day-34 durable transport behind the same IEventBus');
  console.log();

  // --- 1. Publish a backlog to the durable stream ------------------------------
  const store = new InMemoryStreamTransport();
  const producer = new RedisEventsBus(store, { pollIntervalMs: 0 });
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    producer.publish(makeEvent(name));
  }
  console.log('  1. backlog: published 5 events to the durable stream (no consumer yet)');
  console.log('     (a durable broker holds them — an in-process bus would have dropped them)');
  console.log();

  // --- 2. worker-1 consumes a partial batch, then "crashes" ---------------------
  const worker1Seen: string[] = [];
  const worker1 = new RedisEventsBus(store, {
    pollIntervalMs: 0,
    batchSize: 2,
    consumerName: 'worker-1',
  });
  worker1.subscribe(EventType.TaskCreated, (e) => worker1Seen.push((e.payload as TaskCreatedPayload).name));
  await worker1.flush(); // one readGroup(2) — delivers 2, then
  worker1.stop(); // "crash": entries c/d/e stay undelivered in the stream
  console.log(`  2. worker-1 drained a partial batch of ${worker1Seen.length}, then crashed`);
  console.log(`     delivered so far: ${worker1Seen.join(', ')}`);
  assert(worker1Seen.length === 2, 'worker-1 consumed exactly one batch');
  console.log();

  // --- 3. worker-2 boots (restart) and drains the rest — nothing lost ----------
  const worker2Seen: string[] = [];
  const worker2 = new RedisEventsBus(store, {
    pollIntervalMs: 0,
    batchSize: 2,
    consumerName: 'worker-2',
  });
  worker2.subscribe(EventType.TaskCreated, (e) => worker2Seen.push((e.payload as TaskCreatedPayload).name));
  await worker2.drain();
  console.log(`  3. worker-2 (restart) drained the remaining ${worker2Seen.length} events`);
  console.log(`     delivered after restart: ${worker2Seen.join(', ')}`);

  const all = [...worker1Seen, ...worker2Seen].sort();
  assert(all.join('') === 'abcde', 'all 5 events delivered exactly once across the restart');
  assert(store.pendingCount === 0, 'no unacked events left behind');
  console.log('     → all 5 events survived the restart (5/5, no loss, no duplicate). ✅');
  console.log();

  // --- 4. Redelivery: an unacked entry comes back; idempotent consumers dedupe --
  const redeliveryStore = new InMemoryStreamTransport();
  const bus = new RedisEventsBus(redeliveryStore, { pollIntervalMs: 0 });
  const rawCalls: string[] = [];
  const deduped = new Set<string>();
  let firstDelivery = true;
  bus.subscribe(EventType.TaskCreated, (e) => {
    rawCalls.push(e.event_id);
    if (firstDelivery) {
      firstDelivery = false;
      throw new Error('crash before ack'); // the entry stays pending
    }
    deduped.add(e.event_id);
  });
  bus.publish(makeEvent('redeliver-me'));
  await bus.drain();
  console.log(`  4. redelivery: ${rawCalls.length} deliveries, ${deduped.size} processed`);
  assert(rawCalls.length === 2, 'an unacked entry is redelivered (at-least-once)');
  assert(deduped.size === 1, 'an idempotent consumer (keyed on event_id) dedupes');
  console.log('     → at-least-once + idempotent consumers dedupe (the safe durable combination). ✅');
  console.log();

  console.log('day-34: the durable queue is an optional transport swap — the contract never moves. ✅');
}

main().catch((error) => {
  console.error('[demo:durable-queue] FAILED:', error);
  process.exit(1);
});
