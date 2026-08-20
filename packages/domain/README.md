# @harness/domain

Shared domain types for the Harness Human-Attention Infrastructure. This package is the single source of truth: every other `@harness/*` package imports from here, and nothing in here may import from another `@harness/*` package.

## Modules

### `ids.ts` — Branded IDs & UUIDv7

`Brand<T, Name>` and `brand()` give structural strings a nominal tag so that `TaskID` and `ChangeID` cannot be passed to each other's slots. `uuidv7()` produces RFC 9562 time-sortable UUIDs from `node:crypto` (48-bit millisecond timestamp). 17 branded ID types are exported, each with a matching `newXxxID()` factory.

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

## Dependency rule

```
@harness/domain → must NOT import from any other @harness/* package
```
