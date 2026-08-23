# Day 03 — Event model + IEventBus

| | |
|---|---|
| **Week** | W1 — Foundation |
| **Spec refs** | Spec 1 §7 (append-only event log invariant), Spec 2 §8 (events) |
| **Estimated effort** | 5h |
| **Prerequisites** | Day 02 (`@harness/domain` types) |

---

## 1. Objectives

- Define the `IEventBus` contract — publish, subscribe, typed dispatch — with a single in-process `EventEmitter` implementation.
- Land the event vocabulary in `@harness/domain` as a const-object union (`<domain>.<entity>_<verb>`) so consumers can exhaustively switch.
- Model the **review-lifecycle events**: ingest (`integration.pr_fetched`, `integration.ticket_fetched`), review output (`review.report_created`, `review.finding_created`, `review.fix_suggestion_created`), verification, attention routing, and `review.decision_submitted`.
- Provide a `correlation_id` on every envelope so a review can be traced end-to-end.

## 2. Design Decisions

- Events are **in-process** today (the engine integrates via the bus + DI, not via direct imports); a Kafka/NATS swap is a later transport change, not a contract change.
- Every event is wrapped in one envelope carrying `event_id`, `event_type`, `correlation_id`, `occurred_at`, and a typed `payload` — the appends that later become the append-only `event_log` (Day 04/17).

```ts
export type EventType =
  | 'integration.pr_fetched'
  | 'integration.ticket_fetched'
  | 'task.created'
  | 'task.state_changed'
  | 'review.report_created'
  | 'review.finding_created'
  | 'review.fix_suggestion_created'
  | 'verification.completed'
  | 'attention.assessment_created'
  | 'attention.item_routed'
  | 'review.decision_submitted';
```

- The review lifecycle is the foreground vocabulary. No **code-generation** event contract is defined here: the retired dispatch/workflow/tool-execution events are intentionally absent.

## 3. Tasks

### 3.1 Event vocabulary (90 min)
- [ ] `@harness/domain` `events/event-types.ts`, `event-envelope.ts`, and per-domain payload types
- [ ] `events/review-events.ts` with `review.report_created` / `finding_created` / `fix_suggestion_created` / `decision_submitted` payloads

### 3.2 IEventBus + impl (120 min)
- [ ] `@harness/event-bus` `IEventBus` interface (typed publish/subscribe, `subscribeOnce`, error isolation)
- [ ] `InProcessEventBus` (EventEmitter) + `noop`/`spy` bus for tests

### 3.3 Tests + docs (90 min)
- [ ] Unit tests: typed dispatch, multiple subscribers, subscriber-throw isolation, correlation propagation
- [ ] Bus `README.md` documenting the transport-swap seam

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/domain/src/events/event-types.ts` | Canonical event type constants |
| `packages/domain/src/events/event-envelope.ts` | Envelope + `correlation_id` |
| `packages/domain/src/events/review-events.ts` | Review-lifecycle payloads |
| `packages/event-bus/src/event-bus.ts` | `IEventBus` interface |
| `packages/event-bus/src/in-process-event-bus.ts` | EventEmitter implementation |
| `packages/event-bus/src/index.ts` | Barrel export |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/event-bus test` passes
- [ ] A review-report event published with a `correlation_id` reaches a subscriber carrying the same id
- [ ] No event type references the retired code-generation workflow (dispatch/merge/rework/tool-execution)

## 6. Notes & Pitfalls

- Subscribers must not break the publisher: catch-and-log per subscriber, never let one handler's throw take down ingest.
- Name events by what happened (past tense), not what to do next — keeps the log a durable record, not a command stream.

---

*Next: [Day 04 — PostgreSQL schema + migrations (incl. review tables)](day-04.md)*