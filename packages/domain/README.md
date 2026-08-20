# @harness/domain — Shared Types & Domain Model

## Trạng thái hiện tại

Stubs: `src/index.ts` chỉ export string `'domain'`. Chưa có type definitions.

---

## Mục đích

Single source of truth cho mọi kiểu dữ liệu dùng chung. Tất cả packages khác import từ đây — không package nào import package engine khác.

---

## Công việc cần làm (Day 02)

### 1. Branded IDs (`src/ids.ts`)

```typescript
// Helper để tạo branded string types
type Brand<K, T> = K & { __brand: T };

// 13 ID types (UUIDv7)
type TaskID         = Brand<string, 'TaskID'>;
type AgentRunID     = Brand<string, 'AgentRunID'>;
type ArtifactID     = Brand<string, 'ArtifactID'>;
type ChangeID       = Brand<string, 'ChangeID'>;
type ContextID      = Brand<string, 'ContextID'>;
type AssessmentID   = Brand<string, 'AssessmentID'>;
type VerificationRequestID = Brand<string, 'VerificationRequestID'>;
type VerificationResultID   = Brand<string, 'VerificationResultID'>;
type EvidenceID     = Brand<string, 'EvidenceID'>;
type ProjectID      = Brand<string, 'ProjectID'>;
type DecisionID     = Brand<string, 'DecisionID'>;
type EventID        = Brand<string, 'EventID'>;
type CorrelationID  = Brand<string, 'CorrelationID'>;

// Factory functions
function newTaskID(): TaskID;
function newAgentRunID(): AgentRunID;
// ... tương tự cho các types còn lại
```

**Lý do**: Ngăn nhầm type — ví dụ không được pass `ArtifactID` vào chỗ chờ `TaskID`. Bug class #1 khi cross-module.

### 2. Status enums (`src/task.ts`, `src/artifact.ts`, v.v.)

```typescript
// Không dùng TS enum — dùng const object + union type
export const TaskStatus = {
  Pending: 'PENDING',
  Queued: 'QUEUED',
  Executing: 'EXECUTING',
  Verifying: 'VERIFYING',
  AwaitingReview: 'AWAITING_REVIEW',
  Approved: 'APPROVED',
  Rejected: 'REJECTED',
  Rework: 'REWORK',
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  AwaitingHumanIntervention: 'AWAITING_HUMAN_INTERVENTION',
  Cancelled: 'CANCELLED',
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];
```

12 canonical states cho Task (theo Spec 2 §3).

### 3. Entity interfaces

| File | Interfaces |
|------|-----------|
| `src/task.ts` | `Task`, `TaskState` (12 states) |
| `src/agent-run.ts` | `AgentRun`, `AgentRunStatus`, `TrajectoryStep`, `AgentExecutionRequest` |
| `src/artifact.ts` | `Artifact`, `ArtifactStatus`, `Change`, `ChangeStatus`, `FileChange` |
| `src/context.ts` | `ContextSnapshot`, `ContextSource` |
| `src/verification.ts` | `VerificationRequest`, `VerificationResult`, `VerificationCheckResult` |
| `src/attention.ts` | `AttentionAssessment`, `AttentionScores`, `AttentionFactor`, `AttentionPolicy` |
| `src/review.ts` | `HumanDecision`, `ReviewQueueItem` |
| `src/provenance.ts` | `ProvenanceChain` |
| `src/events.ts` | `EventEnvelope<T>`, `EventType` constants |

### 4. Result type (`src/result.ts`)

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

Dùng cho explicit error handling trong pure logic.

### 5. Tests

- Branded ID misuse phải là compile error (`@ts-expect-error`)
- Factory functions produce unique, parseable values
- ≥ 90% exported symbols có TSDoc comments

---

## Dependency rule

```
packages/domain → KHÔNG import gì từ @harness/* packages khác
```

---

## Files cần tạo

```
src/
├── ids.ts          # Branded IDs + factories
├── result.ts       # Result<T, E> type
├── task.ts         # Task, TaskStatus
├── agent-run.ts    # AgentRun, TrajectoryStep
├── artifact.ts     # Artifact, Change, FileChange
├── context.ts      # ContextSnapshot, ContextSource
�├── verification.ts # VerificationRequest, CheckKind, CheckStatus
├── attention.ts    # AttentionAssessment, PriorityLabel
├── review.ts       # HumanDecision, ReviewQueueItem
├── provenance.ts   # ProvenanceChain
├── events.ts       # EventEnvelope, EventType
└── index.ts        # Barrel exports
```
