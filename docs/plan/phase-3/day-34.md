# Day 34 — Durable Queue (Redis/SQS) behind `IEventBus` (Optional)

| | |
|---|---|
| **Week** | 7 — Close the loop |
| **Spec refs** | Spec 2 §6 (durable queue behind `IEventBus`); Phase-3 README §3 (Queue anchor, invariant preserved) |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 31–33 (closed loop); in-process `EventEmitter` `IEventBus` live |

---

## 1. Objectives

By end of day you will have:

1. A **durable `IEventBus` implementation** (Redis Streams or SQS) as an *optional transport swap* behind the existing `IEventBus` interface — no event-contract change.
2. The in-process bus stays the default; durable transport is a config/flag choice per deployment.
3. The closed-loop job survives a worker restart mid-cycle (queued events are not lost).
4. An invariant test: swapping the transport does not change the event payload/contract.

This is the *optional infrastructure* item — the loop works in-process today; durability makes it crash-safe where operators want it.

---

## 2. Design Decisions

### 2.1 Transport swap, contract frozen

`IEventBus.publish/subscribe` signature is unchanged; only the concrete behind it changes. A new `RedisEventsBus` (or `SqsEventsBus`) implements the same interface. Engines that consume events don't know or care which transport they're on.

### 2.2 At-least-once with idempotent consumers

Durable delivery is **at-least-once** — consumers (memory ingestor, learning job, verification) must already be idempotent (Days 08/19 gave us exactly that). Document the requirement: a durable bus is only safe because consumers dedupe.

### 2.3 Optional, behind a flag

`EVENT_TRANSPORT=inproc|redis|sqs`; default `inproc`. Nothing in the hot path changes when `inproc` is selected. The optionality keeps the monolith's deploy simplicity while offering durability where a queue already exists.

### 2.4 Failure mode: reconnect + retry, never silent drop

A dropped Redis connection retries with backoff and (configurable) DLQ, and the health endpoint reflects it. The demo shows restart-survival, not just happy-path publish.

---

## 3. Tasks

### 3.1 `RedisEventsBus` (90 min)

- [ ] Implement `IEventBus` over Redis Streams — publish/consume groups + ack.

### 3.2 Transport selection (45 min)

- [ ] `EVENT_TRANSPORT` resolver; default `inproc`; DI wires the chosen bus.

### 3.3 Restart-survival demo (60 min)

- [ ] `scripts/demo-durable-queue.ts` — publish backlog, restart consumer, prove no loss.

### 3.4 Retry/DLQ + health (45 min)

- [ ] Backoff reconnect; DLQ; health endpoint reflects transport state.

### 3.5 Tests (60 min)

- [ ] Contract-invariance: same events over both transports; at-least-once + idempotent consumer dedupe; default stays `inproc`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/orchestrator/src/bus/redis-events-bus.ts` (or `@harness/event-bus`) | Durable `IEventBus` |
| `packages/event-bus/src/transport-resolver.ts` | `EVENT_TRANSPORT` resolver |
| `scripts/demo-durable-queue.ts` | Restart-survival demo |
| `packages/event-bus/src/__tests__/durable.test.ts` | Transport + contract tests |

---

## 5. Acceptance Criteria

- [ ] A durable `IEventBus` implementation works with the existing event contract (payloads unchanged).
- [ ] `EVENT_TRANSPORT` selects inproc/redis(/sqs); default `inproc`.
- [ ] Restart mid-cycle loses no queued events (demo proves).
- [ ] Idempotent consumers dedupe under at-least-once delivery.
- [ ] Reconnect/backoff + DLQ on transport failure.

---

## 6. Notes & Pitfalls

- **At-least-once means consumers MUST dedupe.** The durable bus only inherits correctness from Days 08/19 idempotency; if a consumer double-processes, the transport upgrade is a downgrade.
- **The event contract does not change.** If swapping transports forces an engine edit, you've broken the seam — stop and reassess.
- **Optional stays optional.** If no queue runs in this deployment, `inproc` must remain the zero-config path.
- **Day 35** checkpoint: closed loop demonstrable.

---

*Next: [Day 35 — Week 7 Checkpoint: Closed Loop Demonstrable](day-35.md)*