# @harness/event-bus

The nervous system of the Harness. Every subsystem publishes and consumes domain events through a single `IEventBus` interface — no package imports another engine directly. Phase 1 is a synchronous, in-process bus; the interface hides that so a future Kafka/NATS broker can replace it without touching any consumer.

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

## Module map

- `ievent-bus.ts` — `IEventBus` interface, `EventHandler<T>`, `UnsubscribeFn`.
- `in-process-event-bus.ts` — `InProcessEventBus`: a Node `EventEmitter` behind `IEventBus`. A throwing handler is caught, reported via `onHandlerError` (default `console.error`), and does not prevent remaining handlers.
- `create-event.ts` — `createEvent()`: stamps a fresh UUIDv7 `event_id`, the current `occurred_at`, and `event_version: 1`.

## Dependency rules

- **Never import another `@harness/*` engine package here.** This package depends only on `@harness/domain`.
- **Payload interfaces live in `@harness/domain`, not here.** `EventEnvelope`, `EventType`, and every `*Payload` type are re-exported from `@harness/domain`'s `events/` module.
