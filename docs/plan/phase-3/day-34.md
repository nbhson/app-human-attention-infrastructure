# Day 34 — Durable Queue (Redis/SQS) Behind `IEventBus` — Contract Unchanged, Optional

| | |
|---|---|
| **Week** | 7 — Close the loop, deploy observed |
| **Spec refs** | Spec 2 §6 (sandbox API + optional external queue/scheduler), Architecture §24 (modular monolith; transport swap) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 33 (closed-loop wiring) |

---

## 1. Objectives

By end of day you will have:

1. A **durable transport** (Redis Streams or AWS SQS) that can back the existing `IEventBus`, so events survive process restarts — an **optional deployment mode**, not a rewrite.
2. **Event contract unchanged**: producers/consumers (orchestrator, verification, multi-agent, learning) do not change a single handler; they still program against `IEventBus`.
3. **At-least-once delivery with dedup**: the durable adapter preserves ordering where required and de-duplicates by `event_id` (idempotent consumers, Day 33's stage handlers already are).
4. **A clean fallback**: the in-process bus remains the default; Redis/SQS is enabled by config only (Spec 2 §6: external queue is optional).

This proves the architectural claim from Day 0: the durable queue is a **transport swap behind `IEventBus`**, not a feature that leaks into domain code.

---

## 2. Design Decisions

### 2.1 Transport behind `IEventBus` (the non-negotiable)

```typescript
export interface IEventBus {
  publish<T extends DomainEvent>(event: T): Promise<void>;         // unchanged
  subscribe<T extends DomainEvent>(
    type: T['type'],
    handler: EventHandler<T>,
    opts?: { concurrency?: number; from?: 'live' | 'beginning' }
  ): Subscription;                                                  // unchanged
}
```

No method signature changes. The durable adapter implements the *same* interface. This is the invariant: if a handler needs to know whether it's on Redis or in-process, the design is wrong.

### 2.2 Durable adapter + config flag

- `EVENT_BUS_TRANSPORT=in-process|redis|sqs` (default `in-process`).
- `RedisEventBus` streams each `publish` to a Redis Stream keyed by event type; consumers read via consumer groups (at-least-once).
- `SqsEventBus` maps domains to SQS queues.
- DI selects the adapter at bootstrap (TOKENS); zero domain-code changes.

### 2.3 At-least-once + idempotent delivery

Durable transports deliver at-least-once. The adapter:
- dedups by `event_id` (UUIDv7) within the consumer's idle window;
- preserves per-type ordering (Redis Stream sequence / SQS FIFO where required);
- surfaces redelivery count so a poison event can be dead-lettered rather than looping forever.

Handlers remain idempotent (the contract they already satisfy for Day 33's loop).

### 2.4 Poison queue + dead-letter

Repeated handler failure → move to a dead-letter stream/queue + emit `event.delivery_failed { event_id, event_type, attempts, reason }`. A poison message must not stall the whole stream or silently vanish.

### 2.5 Optional + reversible

`in-process` stays the default for the modular monolith dev/test experience. The durable adapter is an *ops knob*: enable it in production for crash-resilience, disable it for local determinism. Nothing in the domain depends on which is active.

---

## 3. Tasks

### 3.1 `RedisEventBus` adapter (150 min)

- [ ] Implement `IEventBus` over Redis Streams + consumer groups; preserve ordering; `event_id` dedup.
- [ ] Config flag `EVENT_BUS_TRANSPORT=redis`; DI selection.

### 3.2 `SqsEventBus` adapter (120 min)

- [ ] Implement `IEventBus` over SQS (FIFO for ordered domains); config flag `sqs`.

### 3.3 Delivery semantics + dead-letter (120 min)

- [ ] At-least-once + redelivery count; dead-letter on repeated failure; `event.delivery_failed` event.

### 3.4 Contract-unchanged proof (90 min)

- [ ] Run the existing event-driven test suites (orchestrator/verification/learning) against both adapters; zero handler changes.
- [ ] A "no-transport-knowledge" architecture test: domain handlers never reference redis/sqs types (lexical check).

### 3.5 Docs (30 min)

- [ ] `docs/architecture/wiring-map.md` — transport selection; `README` — optional durable queue note.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/event-bus/src/redis/redis-event-bus.ts` | Redis Streams adapter |
| `packages/event-bus/src/sqs/sqs-event-bus.ts` | SQS adapter |
| `packages/event-bus/src/transport.ts` | Transport selection + config |
| `packages/event-bus/src/dead-letter.ts` | Poison/dead-letter handling |
| `packages/event-bus/src/__tests__/contract.test.ts` | Contract-unchanged proof across transports |

---

## 5. Acceptance Criteria

- [ ] `IEventBus` interface is byte-for-byte unchanged.
- [ ] Redis and SQS adapters both implement `IEventBus`, selected by config (`in-process` default).
- [ ] Existing orchestrator/verification/multi-agent/learning event tests pass against both adapters with **zero handler changes**.
- [ ] At-least-once delivery with `event_id` dedup; repeated-failure events are dead-lettered + `event.delivery_failed` emitted.
- [ ] No domain handler references redis/sqs types (architecture/lexical test).
- [ ] Disabling the durable adapter restores `in-process` with no behavior change.
- [ ] `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **The swap must be invisible.** If flipping `EVENT_BUS_TRANSPORT` breaks a handler, the "transport is just an implementation detail" claim is false, and domain code has sprouted transport assumptions. The architecture test is the proof, not a comment.
- **At-least-once ⇒ idempotent consumers.** A durable transport *will* redeliver. If a consumer isn't idempotent, the queue becomes a source of duplicate side effects (double memory writes, double deploys). Dedup by `event_id` + idempotent handlers.
- **Poison messages must not stall the stream.** Without dead-lettering, one permanently-failing event blocks everything behind it (or loops forever). Move it aside and emit a visibility event.
- **In-process stays default.** The modular monolith's dev/test determinism depends on the in-process bus. Redis/SQS is an ops mode, not a "better default" you adopt casually.
- **This is optional (Spec 2 §6) — don't make it mandatory.** The week's real deliverable is the closed loop (Day 33). The durable queue is resilience plumbing, valuable but not the point.
- **Tomorrow (Day 35):** Week 7 checkpoint — closed loop demonstrable autonomously.

---

*Prev: [Day 33 — Closed-Loop Wiring: Evaluate → Calibrate → Deploy → Observe Runs Continuously](day-33.md) | Next: [Day 35 — Week 7 Checkpoint: Closed Loop Demonstrable Autonomously](day-35.md)*
