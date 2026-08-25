# @harness/domain

Shared domain types for the Harness Human-Attention Infrastructure. This package
is the **single source of truth**: every other `@harness/*` package imports from
here, and nothing in here may import from another `@harness/*` package.

**Status:** living — mirrors the built system ·
**Boundary rule:** **nothing here imports another `@harness/*` package.**

---

## Purpose

1. **Brand the identifiers** — 22 branded ID types so cross-entity assignment is a compile error.
2. **Define the aggregates** — Task, AgentRun, Artifact, Change, Context, Verification, Attention, Review, Identity.
3. **Define the event vocabulary** — `EventType`, `EventEnvelope`, and a payload per event.
4. **Provide factories** — guaranteed-valid initial state for every aggregate.

The "dictionary standardization" catches mistakes at compile time through four
mechanisms: **branded IDs** (block the wrong ID), a **closed status union**
(block invalid values), **`Result<T,E>`** (force the error branch to be handled),
and **factories** (guarantee valid initial state).

---

## Branded IDs (22) + UUIDv7

`Brand<T, Name>` gives a structural `string` a nominal tag, so `TaskID` and
`ChangeID` cannot be passed to each other's slots. `uuidv7()` (RFC 9562) is
time-sortable — the first 48 bits are the Unix-millis timestamp.

```text
TaskID, WorkflowID, AgentRunID, ArtifactID, ChangeID, SnapshotID, ContextID,
AssessmentID, VerificationRequestID, VerificationResultID, EvidenceID,
ProjectID, DecisionID, EventID, PolicyID, ClaimID, ReviewerID, CorrelationID,
ReviewQueueItemID, AssessmentFeedbackID, UserID, SessionID
```

Each has a matching `newXxxID()` factory.

---

## `result.ts` — `Result<T, E>`

A discriminated union (`ok` / `err`) plus `ok()`, `err()`, `isOk()`, `isErr()`,
`map()`, `unwrapOr()` for explicit, exception-free error handling.

---

## `task.ts` — Tasks & the 13 canonical states

`TaskStatus` (below), `Priority` (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`), `Owner`
(`human` | `system`), `FailureStrategy` (`FAIL_FAST`/`CONTINUE`/`ROLLBACK`), the
`Task` entity, and `createTask()`.

```text
PENDING, QUEUED, EXECUTING, VERIFYING, AWAITING_REVIEW, APPROVED, REJECTED,
REWORK, COMPLETED, FAILED, AWAITING_HUMAN_INTERVENTION, CANCELLED, RETRYING
```

`createTask()` defaults: `PENDING`, `owner: 'system'`, `priority: MEDIUM`,
`retryCount: 0`, `maxRetries: 3`, `timeoutSeconds: 3600`. The *transition graph*
over these states lives in `@harness/orchestrator` (`TaskStateMachine`), not here.

---

## `agent-run.ts` — Agent execution

- `AgentType` — `CODING_AGENT`, `TESTING_AGENT`, `REVIEW_AGENT`, `DOCUMENTATION_AGENT`, `ARCHITECTURE_AGENT`.
- `AgentRunStatus` (run lifecycle) — `INITIALIZED`, `PLANNING`, `EXECUTING`, `TOOL_CALLING`, `OBSERVING`, `FINALIZING`, `COMPLETED`, `FAILED`, `ESCALATED`, `CANCELLED`, `ERROR`.
- `AgentExecutionStatus` (terminal) — `SUCCESS`, `FAILED`, `CANCELLED`, `PARTIAL`.
- `ModelProvider` — `openai`, `anthropic`, `gemini`.
- `TrajectoryStep` — discriminated union `THOUGHT` / `TOOL_CALL` / `OBSERVATION`, all with `stepIndex` + `timestamp`.
- `AgentRun` — the event-sourced run (append-only `steps`), `AgentExecutionRequest`, `DEFAULT_MAX_STEPS = 10`, `createAgentExecutionRequest()`.

---

## `artifact.ts` — Artifacts & changes

`ArtifactType`, `ArtifactStatus`, `ChangeStatus`, `FileChangeType`, `Artifact`,
`FileChange`, `Change`, `ArtifactSnapshot`, plus `createArtifact()`/`createChange()`.

---

## `context.ts` — Context snapshots

`ContextSourceType`, `CompressionStrategy`, `ContextSource`, `ContextSnapshot`,
`RepositoryRef`, `ContextRequest`, `ContextPolicy`, plus factories.

---

## `verification.ts` — Trust pipeline

`VerificationCheckType`, `VerificationStatus`, `VerificationCheckResultStatus`,
`VerificationErrorSeverity`, `VerificationPriority`, and the `VerificationCheck`,
`VerificationError`, `VerificationCheckResult`, `VerificationRequest`,
`VerificationResult`, `VerificationPolicy` types, with factories.

---

## `attention.ts` — Attention assessment

`PriorityLabel` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), `SuggestReviewDepth`,
`AttentionRuleAction`, `AttentionScores`, `AttentionFactor`, `AttentionRule`,
`AttentionPolicy`, `AttentionAssessment`, plus factories.

---

## `review.ts` — Human decisions & review queue

- `HumanDecisionType` — `APPROVED`, `REJECTED`, `REQUEST_CHANGES`, `OVERRIDDEN`, `DEFERRED`, `ESCALATED`, `AUTO_APPROVED`.
- `ReviewQueueStatus` (persistence) — `QUEUED`, `CLAIMED`, `DECIDED`, `DROPPED`, `ESCALATED`.
- `ReviewQueueItemStatus` (presentation) — `PENDING`, `IN_PROGRESS`, `RESOLVED`.
- `HumanDecision`, `ReviewQueueItem`, `createHumanDecision()`, `createReviewQueueItem()`.

---

## `identity.ts`, `actor-context.ts`, `provenance.ts`

- `identity.ts` — the `users`/`sessions` identity model.
- `actor-context.ts` — the authenticated actor carried on a request.
- `provenance.ts` — `ProvenanceChain`, a cross-aggregate read-model linking a
  task to its context, trajectory, changes, verification, risk assessment, and decision.

---

## `events/` — Domain event vocabulary

`EventType` (const-object union, 33 values), `EventEnvelope<T>` (`event_id`,
`event_type`, `event_version`, `occurred_at`, `correlation_id`, `payload`), and
one `*Payload` interface per event.

```text
task:     task.created, task.state_changed, task.execution_finished, task.failed,
          task.orphan_recovered
artifact: artifact.created, artifact.changed, artifact.rollback_requested, artifact.merged
verification: verification.completed
attention: attention.assessment_created, attention.item_routed,
          attention.threshold_adjusted, attention.inflation_detected, attention.item_deferred
review:   review.decision_submitted, review.item_claimed, review.item_released,
          review.item_escalated, review.report_created, review.fix_suggestion_created
authz:    authz.decision_denied
evaluation: evaluation.escalation_leakage
integration: integration.pr_fetched, integration.ticket_fetched,
          integration.writeback_completed
memory:   memory.entry_created, memory.consolidated, memory.archived
learning: learning.stage_completed, learning.loop_completed
system:   system.started, system.stopped
```

The bus that transports these lives in `@harness/event-bus`. `TaskTrigger`
(`orchestrator` | `agent_runtime` | `verification_engine` | `auto_approve` |
`human`) names the actor that changed a task state.

---

## Module map

| File | Holds |
| --- | --- |
| `ids.ts` | 22 branded IDs + `uuidv7()` + factories. |
| `result.ts` | `Result<T,E>`. |
| `task.ts` | `TaskStatus`, `Task`, `createTask`. |
| `agent-run.ts` | agent lifecycle, trajectory, execution request. |
| `artifact.ts` | artifacts & changes. |
| `context.ts` | context snapshots. |
| `verification.ts` | trust pipeline. |
| `attention.ts` | attention assessment. |
| `review.ts` | decisions & review queue. |
| `identity.ts` / `actor-context.ts` | users/sessions + request actor. |
| `provenance.ts` | provenance read-model. |
| `events/` | event types + payloads. |

## Dependency rule

```
@harness/domain → must NOT import from any other @harness/* package
```