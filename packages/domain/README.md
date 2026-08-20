# @harness/domain

Shared domain types for the Harness Human-Attention Infrastructure. This package is the single source of truth: every other `@harness/*` package imports from here, and nothing in here may import from another `@harness/*` package.

## Hiểu nhanh — gói này làm gì? (nói nôm na)

`@harness/domain` là **bộ định nghĩa dữ liệu chuẩn** của toàn hệ thống. Nó **không chạy gì cả** — chỉ khai báo các kiểu (types) mà mọi package khác dùng chung, giống như **bộ mẫu đơn chuẩn** phát cho các phòng ban trước khi họ bắt tay vào làm việc.

| File | Chứa gì | Nói nôm na |
|------|---------|------------|
| `ids.ts` | 18 loại ID + hàm sinh ID | Mỗi "đồ vật" (Task, Artifact…) có mã số kiểu riêng, không lẫn nhau. |
| `task.ts` | `Task` (25 trường) + 13 trạng thái | Mẫu đơn "Task": gồm những mục nào, ở trạng thái nào. |
| `result.ts` | `Result<T,E>` | Quy ước báo "thành công / thất bại". |
| `events/` | `EventEnvelope`, `EventType`, các `*Payload` | Mẫu đơn cho các "sự kiện" trên bus. |
| `*.test.ts` | Test | Kiểm tra các định nghĩa + hàm tạo. |

Việc "chuẩn hóa từ điển" bắt lỗi ngay lúc biên dịch nhờ 4 cơ chế: **branded ID** (chặn đưa nhầm ID), **status là union đóng** (chặn giá trị sai), **`Result<T,E>`** (bắt xử lý cả nhánh lỗi), và **factory** (đảm bảo trạng thái khởi tạo hợp lệ). Chi tiết từng module ở mục [Modules](#modules).

## Modules

### `ids.ts` — Branded IDs & UUIDv7

`Brand<T, Name>` and `brand()` give structural strings a nominal tag so that `TaskID` and `ChangeID` cannot be passed to each other's slots. `uuidv7()` produces RFC 9562 time-sortable UUIDs from `node:crypto` (48-bit millisecond timestamp). 18 branded ID types are exported, each with a matching `newXxxID()` factory.

### `result.ts` — `Result<T, E>`

A discriminated union (`ok` / `err`) plus the `ok()`, `err()`, `isOk()`, `isErr()`, `map()`, and `unwrapOr()` helpers for explicit, exception-free error handling.

### `task.ts` — Tasks

`TaskStatus` (13 states, including `RETRYING`), `Priority`, `Owner`, `JsonSchema`, `FailureStrategy`, the `Task` entity, and `CreateTaskInput` / `createTask()` with sensible defaults (Pending, system owner, Medium priority, retry counter, timeouts).

### `agent-run.ts` — Agent execution

`AgentType`, `AgentRunStatus` (the run lifecycle) and `AgentExecutionStatus` (the execution sub-state), `ModelProvider`, `ModelConfig`, the `TrajectoryStep` discriminated union (`THOUGHT` / `TOOL_CALL` / `OBSERVATION`), `AgentRun`, `AgentExecutionRequest`, `DEFAULT_MAX_STEPS`, and `createAgentExecutionRequest()`.

### `artifact.ts` — Artifacts & changes

`ArtifactType`, `ArtifactStatus`, `ChangeStatus`, `FileChangeType`, `Artifact`, `FileChange`, `Change`, `ArtifactSnapshot`, and the `createArtifact()` / `createChange()` factories.

### `context.ts` — Context snapshots

`ContextSourceType`, `CompressionStrategy`, `ContextSource`, `ContextSnapshot`, `RepositoryRef`, `ContextRequest`, `ContextPolicy`, plus `createContextSource()` and `createContextSnapshot()`.

### `verification.ts` — Trust pipeline

`VerificationCheckType`, `VerificationStatus`, `VerificationCheckResultStatus`, `VerificationErrorSeverity`, `VerificationPriority`, the `VerificationCheck`, `VerificationError`, `VerificationCheckResult`, `VerificationRequest`, `VerificationResult`, and `VerificationPolicy` types, with `createVerificationRequest()`, `createVerificationCheckResult()`, and `createVerificationError()`.

### `attention.ts` — Attention assessment

`PriorityLabel`, `SuggestReviewDepth`, `AttentionRuleAction`, `AttentionScores`, `AttentionFactor`, `AttentionRule`, `AttentionPolicy`, `AttentionAssessment`, and the `createAttentionAssessment()` / `createAttentionScores()` factories.

### `review.ts` — Human decisions & review queue

`HumanDecisionType`, `HumanDecision`, `ReviewQueueItemStatus`, `ReviewQueueItem`, and `createHumanDecision()` / `createReviewQueueItem()`. The review queue is a read-model with no separate upstream spec section, so it is kept minimal.

### `provenance.ts` — Read-model

`ProvenanceChain` — a cross-aggregate read-model linking a task to its context, agent trajectory, changes, verification, risk assessment, and human decision.

### `events/` — Domain events

`event-types.ts` (`EventType` const-object union), `event-envelope.ts` (`EventEnvelope<T>` — `event_id`, `event_type`, `event_version`, `occurred_at`, `correlation_id`, `payload`), and one `*Payload` interface per event (`task-events.ts`, `artifact-events.ts`, `verification-events.ts`, `attention-events.ts`, `review-events.ts`). The bus that transports these lives in `@harness/event-bus`.

## Dependency rule

```
@harness/domain → must NOT import from any other @harness/* package
```