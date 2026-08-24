# @harness/event-bus

The nervous system of the Harness. Every subsystem publishes and consumes domain
events through a single `IEventBus` interface — no package imports another engine
directly.

**Status:** complete (as-built) ·
**Boundary rule:** depends only on `@harness/domain`; never imports another engine.

---

## Purpose

1. **Define the `IEventBus` seam** — so a future Kafka/NATS broker can replace the in-process bus without touching any consumer.
2. **Provide an in-process implementation** — a Node `EventEmitter` behind the interface.
3. **Stamp events** — a fresh UUIDv7 `event_id`, `occurred_at`, and `event_version` per event.

---

## Model

```text
   publisher ──▶ publish(createEvent(type, correlationId, payload))
                                 │
                                 ▼
                        ┌────────────────────┐
                        │  InProcessEventBus │  (Node EventEmitter)
                        └─────────┬──────────┘
         ┌──────────────┬─────────┼──────────┬──────────────┐
         ▼              ▼         ▼          ▼              ▼
    Attention       Evidence    Memory    (any subscriber,  (a throwing handler
     Engine          Store      System     via subscribe)    is caught + reported,
                                                             others still run)
```

---

## Usage

```typescript
import { InProcessEventBus, createEvent } from '@harness/event-bus';
import { EventType, newCorrelationID } from '@harness/domain';

const bus = new InProcessEventBus();

const unsubscribe = bus.subscribe(EventType.TaskStateChanged, (event) => {
  console.log(`${event.event_type}: ${event.payload.task_id}`);
});

bus.publish(
  createEvent(EventType.TaskStateChanged, newCorrelationID(), {
    task_id: newTaskID(),
    from_state: TaskStatus.Executing,
    to_state: TaskStatus.Verifying,
    triggered_by: 'verification_engine',
    attempt_number: 1,
  }),
);

unsubscribe();
```

---

## Modules

| Module | What it provides |
| --- | --- |
| `ievent-bus.ts` | `IEventBus`, `EventHandler<T>`, `UnsubscribeFn`. |
| `in-process-event-bus.ts` | `InProcessEventBus` — a `EventEmitter` behind `IEventBus`. A throwing handler is caught, reported via `onHandlerError` (default `console.error`), and does not stop the rest. |
| `create-event.ts` | `createEvent()` — stamps UUIDv7 `event_id`, `occurred_at`, `event_version: 1`. |

---

## Key invariants

- **Never import an engine here.** This package depends only on `@harness/domain`.
- **Payloads live in `@harness/domain`.** `EventEnvelope`, `EventType`, and every
  `*Payload` type are re-exported from `@harness/domain`'s `events/` module — the
  bus only *transports* them.
- **Handler isolation.** A throwing handler never prevents the remaining
  handlers from running.

---

## Directory structure

```
src/
├── index.ts
├── ievent-bus.ts
├── in-process-event-bus.ts
└── create-event.ts
```

## Public API surface

```typescript
// IEventBus, EventHandler, UnsubscribeFn, InProcessEventBus, createEvent
```

## Dependency rule

```
packages/event-bus → depends only on @harness/domain
```