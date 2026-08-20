# Day 03 — Event Model & `IEventBus`

| | |
|---|---|
| **Week** | 1 — Foundation |
| **Spec refs** | Spec 2 §8 (Event Envelope), Spec 1 §6 (Event Bus) |
| **Estimated effort** | 6–7 hours |
| **Prerequisites** | Day 02 (domain types, branded IDs, EventID) |

---

## 1. Objectives

By end of day you will have:

1. A canonical, versioned **event envelope** type shared by all subsystems.
2. A set of **domain event type constants** (const-object unions, per domain package conventions).
3. A fully tested **in-process `IEventBus`** implementation in `packages/event-bus`.
4. A **correlation ID** mechanism so every event can be traced back to a task/run.

This is the nervous system of the Harness. Every subsequent package emits and/or consumes events through this single interface — no package may import another engine directly.

---

## 2. Design Decisions

### 2.1 Event Envelope (Spec 2 §8)

Every event on the bus has exactly this shape. No exceptions.

```typescript
interface EventEnvelope<TPayload = unknown> {
  event_id:      EventID;       // UUIDv7 — unique per emission
  event_type:    EventType;     // namespaced constant, e.g. "task.state_changed"
  event_version: number;        // schema version of payload, starts at 1
  occurred_at:   Date;          // UTC, set by the emitter, never by the bus
  correlation_id: CorrelationID; // traces back to the originating TaskID or AgentRunID
  payload:       TPayload;
}
```

**Why `event_version`?** Payload schemas will evolve. Versioning from day one means a Phase 2 consumer can still read Phase 1 events without migration pain.

**Why `correlation_id`?** Observability (Day 27) and provenance queries (Day 26) depend on being able to answer: *"show me everything that happened because of task X."* Without a correlation ID stamped at emission time, this is impossible to retrofit.

### 2.2 Event Type Naming Convention

Format: `<domain>.<entity>_<verb_past_tense>`

Examples:
- `task.state_changed`
- `task.execution_finished`
- `artifact.changed`
- `verification.completed`
- `attention.assessment_created`
- `review.decision_submitted`

Use a **const object** (not a TS enum) so consumers can exhaustively switch over values:

```typescript
export const EventType = {
  TaskStateChanged:        'task.state_changed',
  TaskExecutionFinished:   'task.execution_finished',
  ArtifactChanged:         'artifact.changed',
  VerificationCompleted:   'verification.completed',
  AssessmentCreated:       'attention.assessment_created',
  DecisionSubmitted:       'review.decision_submitted',
  // ... extend as new packages come online
} as const;
export type EventType = typeof EventType[keyof typeof EventType];
```

### 2.3 IEventBus Interface

Phase 1: **synchronous in-process** (Node `EventEmitter` under the hood), hidden behind an interface so the Phase 2+ Kafka/NATS swap touches zero consumers.

```typescript
interface IEventBus {
  publish<T>(event: EventEnvelope<T>): void;
  subscribe<T>(eventType: EventType, handler: EventHandler<T>): UnsubscribeFn;
  // No queryable history in Phase 1 — the event log table (Day 4) handles that.
}
```

**Rules:**
- `publish` is fire-and-forget from the emitter's perspective.
- Handlers are called synchronously in subscription order. A throwing handler must not crash the bus — wrap in try/catch, log, continue.
- The bus does **not** validate payloads. Payload schema validation is the emitter's responsibility (domain factories, Day 02).
- The bus does **not** persist events. Persistence is handled by a dedicated subscriber (`EventLogWriter`, Day 04) that writes every event to the `event_log` table. This keeps the bus itself trivially testable.

### 2.4 Typed Payload Interfaces

Each event type has a matching payload interface defined in `packages/domain/src/events/`:

```typescript
// packages/domain/src/events/task-events.ts
export interface TaskStateChangedPayload {
  task_id: TaskID;
  from_state: TaskState;
  to_state: TaskState;
  triggered_by: 'orchestrator' | 'agent_runtime' | 'verification_engine' | 'human';
  attempt_number: number;
}
```

Keep payload interfaces in `packages/domain` (not `packages/event-bus`) so the event bus package has zero domain dependencies.

---

## 3. Tasks

### 3.1 Create `packages/event-bus` scaffold (30 min)

- [x] `packages/event-bus/package.json` — name `@harness/event-bus`, dep on `@harness/domain` only.
- [x] `packages/event-bus/tsconfig.json` — extends root base config.
- [x] `packages/event-bus/src/index.ts` — barrel export (empty for now).
- [x] `packages/event-bus/vitest.config.ts`.

### 3.2 Define event types in `packages/domain` (60 min)

- [x] `packages/domain/src/events/event-envelope.ts` — `EventEnvelope<T>`, `CorrelationID` branded type.
- [x] `packages/domain/src/events/event-types.ts` — `EventType` const object (all types listed in §2.2).
- [x] `packages/domain/src/events/task-events.ts` — `TaskStateChangedPayload`, `TaskExecutionFinishedPayload`, `TaskCreatedPayload`.
- [x] `packages/domain/src/events/artifact-events.ts` — `ArtifactChangedPayload` (fields: `artifact_id`, `change_id`, `change_type`, `content_hash`, `agent_run_id`).
- [x] `packages/domain/src/events/verification-events.ts` — `VerificationCompletedPayload` (fields: `request_id`, `result_id`, `status`, `check_summaries[]`).
- [x] `packages/domain/src/events/attention-events.ts` — `AssessmentCreatedPayload` (fields: `assessment_id`, `artifact_id`, `combined_priority`, `label`).
- [x] `packages/domain/src/events/review-events.ts` — `DecisionSubmittedPayload` (fields: `decision_id`, `change_id`, `decision`, `reviewer_id`).
- [x] `packages/domain/src/events/index.ts` — barrel.
- [x] Update `packages/domain/src/index.ts` to re-export `events/`.

### 3.3 Implement `IEventBus` interface + `InProcessEventBus` (90 min)

- [x] `packages/event-bus/src/ievent-bus.ts` — interface definition + `EventHandler<T>` + `UnsubscribeFn` types.
- [x] `packages/event-bus/src/in-process-event-bus.ts` — implementation using Node `EventEmitter`:
  - `publish`: emit on channel = `event_type`; wrap handler call in try/catch; on error, call injected `onHandlerError` callback (default: `console.error`) and continue.
  - `subscribe`: register on channel; return unsubscribe function.
  - `subscriberCount(eventType)`: expose for testing.
- [x] `packages/event-bus/src/index.ts` — export `IEventBus`, `InProcessEventBus`, `EventHandler`, `UnsubscribeFn`.

### 3.4 Event factory helper (45 min)

- [x] `packages/event-bus/src/create-event.ts` — helper that stamps `event_id` (UUIDv7), `occurred_at` (now), and `event_version: 1`:

```typescript
export function createEvent<T>(
  event_type: EventType,
  correlation_id: CorrelationID,
  payload: T,
  event_version = 1
): EventEnvelope<T>
```

- [x] Unit test: `event_id` is a valid UUIDv7, `occurred_at` is within 1s of now, `event_version` defaults to 1.

### 3.5 Tests (90 min)

Write tests **before** considering the task done. File: `packages/event-bus/src/__tests__/in-process-event-bus.test.ts`

- [x] `publish` calls all handlers subscribed to that event type.
- [x] `publish` does not call handlers subscribed to a different event type.
- [x] A throwing handler does not prevent subsequent handlers from being called.
- [x] `unsubscribe()` removes the handler; subsequent publishes are not received.
- [x] `subscriberCount` returns correct count after subscribe/unsubscribe.
- [x] Events carry the exact envelope fields (`event_id`, `event_type`, `event_version`, `occurred_at`, `correlation_id`, `payload`).
- [x] `createEvent` produces a valid envelope with correct defaults.

### 3.6 README (30 min)

- [x] `packages/event-bus/README.md`:
  - One-paragraph purpose statement.
  - Usage example: subscribe to `task.state_changed`, publish a `createEvent`-built envelope.
  - Rule: "Never import another `@harness/*` engine package here. This package depends only on `@harness/domain`."
  - Rule: "Payload interfaces live in `@harness/domain`, not here."

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/domain/src/events/` | All event payload interfaces + `EventType` const + `EventEnvelope` |
| `packages/event-bus/src/ievent-bus.ts` | `IEventBus` interface |
| `packages/event-bus/src/in-process-event-bus.ts` | Phase 1 implementation |
| `packages/event-bus/src/create-event.ts` | Envelope factory |
| `packages/event-bus/src/__tests__/in-process-event-bus.test.ts` | Full test suite |
| `packages/event-bus/README.md` | Usage + dependency rules |

---

## 5. Acceptance Criteria

- [x] `pnpm --filter @harness/event-bus test` — all tests pass.
- [x] `pnpm --filter @harness/event-bus build` — clean build, zero errors.
- [x] `grep -r "from '@harness" packages/event-bus/src` shows only `@harness/domain`.
- [x] `EventEnvelope` interface matches §2.1 exactly (field names, types).
- [x] `EventType` const object has at least the 6 event types listed in §2.2.
- [x] A throwing subscriber does not crash the bus or skip remaining subscribers (test proves this).
- [x] `createEvent` stamps a UUIDv7 `event_id` and current `occurred_at` automatically.

---

## 6. Notes & Pitfalls

- **Do not add `async` to `publish`.** Phase 1 is synchronous. Adding async now creates a false expectation of durability; the `EventLogWriter` subscriber (Day 4) is where persistence lives.
- **Do not validate payloads in the bus.** Validation in the bus creates a coupling point that will hurt when payloads evolve. Emitters validate via domain factories.
- **`correlation_id` is not optional.** If you find yourself wanting to publish an event without one, that event is probably not a domain event — use a log line instead.
- **`EventEmitter` listener leak warning:** Node warns at >10 listeners per channel. This is fine in tests (subscribe/unsubscribe cycles); do not suppress the warning globally — it will catch real leaks in integration tests.
- **Naming:** `InProcessEventBus`, not `LocalEventBus` or `SyncEventBus`. "In-process" is the Phase 1 architectural constraint; the name should make that visible.
- **Tomorrow (Day 4):** the `EventLogWriter` subscriber will persist every event to `event_log` in PostgreSQL. Do not build that today — today's bus must remain pure and persistence-free.

---

## 7. Status vs Plan (scanned 2026-08-20)

All 26 task checkboxes and 7 acceptance criteria are complete. `@harness/event-bus` builds standalone (turbo `dependsOn: ^build` builds `@harness/domain` first), typechecks, lints clean, and has 9 green tests (41 repo-wide). `grep -r "from '@harness" packages/event-bus/src` shows only `@harness/domain`.

Divergences from the plan:

- **`CorrelationID` lives in `ids.ts`**, not `event-envelope.ts` — added beside the other 17 branded IDs with a `newCorrelationID()` factory; `event-envelope.ts` imports it.
- **`EventType` has 7 members** (PascalCase keys): the 6 from §2.2 plus `task.created` (to back `TaskCreatedPayload`). Values follow `<domain>.<entity>_<verb_past_tense>`.
- **Payload field names are snake_case** (`task_id`, `from_state`, `content_hash`, `check_summaries`, …) per §2.1/§2.4 — a serialization boundary that maps 1:1 to Day 04's `event_log` columns, distinct from the camelCase domain entities.
- **`from_state`/`to_state` are typed `TaskStatus`** (the actual Day 02 union — 13 states), not the plan's `TaskState`.
- **No per-package `vitest.config.ts` or `test` script**: tests run from the workspace root via `pnpm test` (root `vitest.config.ts` include `packages/*/src/**/*.test.ts`), consistent with Day 02.
- **`subscriberCount` is on `InProcessEventBus` only**, not `IEventBus` — §2.3 keeps the interface to `publish`/`subscribe`.
- **`createEvent` uses `newEventID()`** (the domain UUIDv7 factory) rather than `uuidv7()` directly, so `event_id` is a branded `EventID`.

Tests added: `packages/event-bus/src/__tests__/in-process-event-bus.test.ts` (8 tests covering the §3.5 bullets plus version override), `packages/event-bus/src/index.test.ts` (barrel smoke), `packages/domain/src/events/events.test.ts` (EventType values + CorrelationID).

---

*Next: [Day 04 — PostgreSQL Schema & Migrations](day-04.md)*
