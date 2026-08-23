# @harness/orchestrator — Task / Work Orchestrator

The canonical `Task` lifecycle and the machinery that walks every task through it:
task creation, the single-source-of-truth state machine, the dispatch loop, the
linear workflow runner, and the retry/failure taxonomy.

**Status:** Phase 1 complete (as-built) ·
**Boundary rule:** engine — imports only shared packages (`@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`).

---

## Purpose

1. **Create tasks** — the smallest indivisible unit of work, keyed by UUIDv7.
2. **Own the state machine** — the one place that decides which transitions are legal (no transition logic lives anywhere else).
3. **Dispatch work** — poll runnable tasks and drive them forward.
4. **Run workflows** — walk a declarative, ordered step list (`COLLECT_CONTEXT → EXECUTE → VERIFY`).
5. **Classify failures & retry** — separate permanent vs transient vs resource failures and apply a retry policy.
6. **Record history** — every transition is an append-only `task_state_history` row.

---

## The canonical state machine

The `TaskStatus` union lives in `@harness/domain`; this package owns *which moves are legal*. The transition table **is** the spec — when in doubt, reject rather than infer.

```text
  PENDING ──▶ QUEUED ──▶ EXECUTING ──▶ VERIFYING ──▶ AWAITING_REVIEW ──▶ APPROVED ──▶ COMPLETED
     │          │            │  │           │  │           │                 │
     │          │            │  │           │  │           └──▶ REJECTED    │
     │          │            │  │           │  │                │  │        │
     │          │            │  │           │  └──▶ REWORK ◀────┘  │        │
     │          │            │  │           └──────▶ FAILED        │        │
     │          │            │  └──────▶ AWAITING_HUMAN_INTERVENTION          │
     │          │            └─────▶ FAILED                                   │
     │          │                                                              │
     └──────────┴──────▶ CANCELLED   (terminal, alongside COMPLETED) ◀─────────┘
```

### Legal transitions (the table, exactly as enforced)

| From | Legal targets |
| --- | --- |
| `PENDING` | `QUEUED`, `CANCELLED` |
| `QUEUED` | `EXECUTING`, `CANCELLED` |
| `EXECUTING` | `VERIFYING`, `FAILED`, `AWAITING_HUMAN_INTERVENTION` |
| `VERIFYING` | `AWAITING_REVIEW`, `REWORK`, `FAILED`, `AWAITING_HUMAN_INTERVENTION` |
| `AWAITING_REVIEW` | `APPROVED`, `REJECTED` |
| `APPROVED` | `COMPLETED`, `AWAITING_HUMAN_INTERVENTION` |
| `REJECTED` | `REWORK`, `FAILED`, `CANCELLED` |
| `REWORK` | `QUEUED`, `CANCELLED`, `FAILED` |
| `COMPLETED` | *(terminal)* |
| `FAILED` | `QUEUED`, `CANCELLED` |
| `AWAITING_HUMAN_INTERVENTION` | `QUEUED`, `CANCELLED` |
| `CANCELLED` | *(terminal)* |
| `RETRYING` | *(defined, currently unreachable — no inbound edge; added for the retry path)* |

Terminal states are `COMPLETED` and `CANCELLED`. Human-driven transitions (e.g.
`AWAITING_REVIEW → APPROVED/REJECTED`, any hand-off to `CANCELLED`) require a
`rationale` on the history record — `MissingRationaleError` otherwise.

---

## Failure classification & retry

A failure is never just a string. `classifyError` maps it into a `FailureClass`
(`PERMANENT` / `TRANSIENT` / `RESOURCE`), and `shouldRetry` + `computeDelay`
(`DEFAULT_RETRY_POLICY`, exponential backoff) decide whether and when to
retry. `RESOURCE` (quota/capacity — e.g. `MAX_STEPS_EXCEEDED`,
`TOKEN_BUDGET_EXCEEDED`) is retried only after a cooldown, never as a logic
failure.

---

## Core data shapes

| Type | What it is |
| --- | --- |
| `TaskRecord` | Typed view of a persisted `tasks` row (`id`, `projectId`, `title`, `state`, `attemptNumber`, `maxAttempts`, `assignedAgent`, `idempotencyKey`, timestamps). |
| `CreateTaskParams` | Minimal create input (`projectId`, `title`, `description?`, `maxAttempts?` → default 3). |
| `TaskStateHistoryEntry` | One `task_state_history` audit-trail row: `fromState`, `toState`, `triggeredBy`, `triggerEventId`, `rationale`, `attemptNumber`. |
| `StepKind` | `COLLECT_CONTEXT` / `EXECUTE` / `VERIFY`. |
| `LINEAR_WORKFLOW_V1` | The single Phase-1 workflow: context (30 s) → execute (300 s) → verify (120 s). |

---

## Modules

| Module | What it provides |
| --- | --- |
| `state-machine/task-state-machine.ts` | `TaskStateMachine` — `canTransition`, `legalTargets`, `isTerminal`, `requiresRationale`. |
| `state-machine/errors.ts` | `IllegalTransitionError`, `MissingRationaleError`, `StateConflictError`, `TerminalStateError`. |
| `task-service.ts` | `TaskService` — validated `transition()` (guards against version skew via `StateConflictError`) + `TransitionOptions`. |
| `dispatch/dispatcher.ts` | `Dispatcher` + `DispatchResult`. |
| `dispatch/dispatch-loop.ts` | `DispatchLoop` + `DispatchLoopLogger` — the poll-and-drive worker. |
| `workflow/workflow-definition.ts` | `WorkflowDefinition`, `WorkflowStep`, `StepKind`, `LINEAR_WORKFLOW_V1`. |
| `workflow/step-handler.ts` | `StepContext`, `StepHandler`, `StepResult`. |
| `workflow/workflow-runner.ts` | `WorkflowRunner` — walks the step list. |
| `retry/failure-class.ts` | `FailureClass`, `ClassifiedFailure`. |
| `retry/classify-error.ts` | `classifyError`. |
| `retry/retry-policy.ts` | `DEFAULT_RETRY_POLICY`, `computeDelay`, `shouldRetry`, `RetryPolicyConfig`. |
| `types.ts` | `CreateTaskParams`, `TaskRecord`, `TaskStateHistoryEntry`. |

---

## Interaction with other packages

```text
            Tasks / transitions / events  (publishes task.*; consumes
            orchestration events from engines via the bus)
                          ▲
                          │ @harness/event-bus
                          │
        ┌─────────────────┼──────────────────────┐
        ▼                 ▼                      ▼
  agent-runtime      verification-engine      review
  (EXECUTE)          (VERIFY)                (AWAITING_REVIEW → decide)
```

The orchestrator never imports another engine — it drives them by advancing the
state machine and reacting to the events they publish (`task.execution_finished`,
`verification.completed`, `review.decision_submitted`). `TaskTrigger` records the
actor: `orchestrator` | `agent_runtime` | `verification_engine` | `auto_approve` | `human`.

---

## Key invariants

- **One source of truth.** Only `TaskStateMachine` encodes legal moves; everything else calls `canTransition`.
- **No transition without evidence.** Human/rationale-required moves must record a reason.
- **Append-only history.** Every hop lands in `task_state_history`; current state is a projection, never an UPDATE of history.
- **Reject, don't infer.** A `(from, to)` not in the table throws `IllegalTransitionError`.

---

## Directory structure

```
src/
├── index.ts                      # public barrel (see below)
├── task-service.ts               # TaskService
├── types.ts                      # TaskRecord / CreateTaskParams / TaskStateHistoryEntry
├── state-machine/
│   ├── task-state-machine.ts     # the transition table
│   └── errors.ts
├── dispatch/
│   ├── dispatcher.ts
│   └── dispatch-loop.ts
├── workflow/
│   ├── workflow-definition.ts    # StepKind, LINEAR_WORKFLOW_V1
│   ├── step-handler.ts
│   └── workflow-runner.ts
└── retry/
    ├── failure-class.ts
    ├── classify-error.ts
    └── retry-policy.ts
```

## Public API surface

```typescript
// state machine + errors
TaskStateMachine, IllegalTransitionError, MissingRationaleError,
StateConflictError, TerminalStateError
// service
TaskService, TransitionOptions
// dispatch
Dispatcher, DispatchResult, DispatchLoop, DispatchLoopLogger
// workflow
StepKind, LINEAR_WORKFLOW_V1, WorkflowDefinition, WorkflowStep,
StepContext, StepHandler, StepResult, WorkflowRunner
// retry
FailureClass, ClassifiedFailure, classifyError, DEFAULT_RETRY_POLICY,
computeDelay, shouldRetry, RetryPolicyConfig
// types
CreateTaskParams, TaskRecord, TaskStateHistoryEntry
```

## Wiring

`TaskService`, the dispatcher, and the workflow runner are registered in
`apps/api/src/bootstrap.ts`. Task routes live in `apps/api/src/routes/tasks.ts`.