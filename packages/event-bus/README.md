# @harness/event-bus — Event System

## Trạng thái hiện tại

Stubs: `src/index.ts` chỉ export string `'event-bus'`. Chưa có implementation.

---

## Mục đích

Nervous system của Harness. Mọi package giao tiếp qua event — **không gọi trực tiếp** giữa các engine.

---

## Công việc cần làm (Day 03)

### 1. Interface `IEventBus` (`src/types.ts`)

```typescript
export type EventType = string; // namespaced: "task.created", "verification.completed", v.v.

export interface EventEnvelope<TPayload = unknown> {
  event_id:       EventID;       // UUIDv7
  event_type:     EventType;     // const-object union
  event_version:  number;        // schema version, bắt đầu từ 1
  occurred_at:    Date;          // UTC, set bởi emitter
  correlation_id: CorrelationID; // trace back tới TaskID hoặc AgentRunID
  payload:        TPayload;
}

export interface IEventBus {
  publish<T>(event: EventEnvelope<T>): void;
  subscribe<T>(event_type: EventType, handler: (event: EventEnvelope<T>) => void): () => void; // returns unsubscribe
  publishSync<T>(event: EventEnvelope<T>): void; // synchronous dispatch
}
```

### 2. In-process implementation (`src/in-process-bus.ts`)

```typescript
import { EventEmitter } from 'node:events';

export class InProcessEventBus implements IEventBus {
  private emitter = new EventEmitter();

  publish<T>(event: EventEnvelope<T>): void {
    this.emitter.emit(event.event_type, event);
  }

  subscribe<T>(event_type: EventType, handler: (event: EventEnvelope<T>) => void): () => void {
    this.emitter.on(event_type, handler);
    return () => this.emitter.off(event_type, handler);
  }
}
```

### 3. Event type constants (`src/event-types.ts`)

```typescript
export const EventTypes = {
  // Task events
  TASK_CREATED: 'task.created',
  TASK_STATE_CHANGED: 'task.state_changed',
  TASK_RETRY_LIMIT_EXCEEDED: 'task.retry_limit_exceeded',

  // Verification events
  VERIFICATION_COMPLETED: 'verification.completed',

  // Review events
  REVIEW_DECISION_SUBMITTED: 'review.decision_submitted',

  // Artifact events
  ARTIFACT_CREATED: 'artifact.created',
  ARTIFACT_CHANGED: 'artifact.changed',

  // Attention events
  ASSESSMENT_CREATED: 'attention.assessment_created',
} as const;

export type EventTypes = typeof EventTypes[keyof typeof EventTypes];
```

### 4. Correlation ID (`src/correlation-id.ts`)

```typescript
export function createCorrelationID(taskId: TaskID): CorrelationID;
export function extractCorrelationID(event: EventEnvelope): CorrelationID | null;
```

Propagation: khi Agent Runtime nhận task, generate correlation_id = taskId. Mọi event sinh ra trong agent run đều dùng correlation_id này.

### 5. Tests

- Publish/subscribe round-trip: event gửi đi → handler nhận đúng payload
- Duplicate handler không double-fire
- Correlation ID consistent xuyên suốt chain
- Unsubscribe hoạt động đúng

---

## Dependency rule

```
packages/event-bus → chỉ import @harness/domain
```

---

## Convention naming

```
<domain>.<entity>_<verb_past_tense>
```

Ví dụ: `task.created`, `task.state_changed`, `verification.completed`, `review.decision_submitted`

---

## Files cần tạo

```
src/
├── types.ts           # IEventBus, EventEnvelope
├── in-process-bus.ts  # EventEmitter-based implementation
├── event-types.ts     # EventType constants
├── correlation-id.ts  # CorrelationID generation & propagation
└── index.ts           # Barrel exports
```
