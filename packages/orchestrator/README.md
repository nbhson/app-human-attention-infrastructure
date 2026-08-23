# @harness/orchestrator — Task state machine

The canonical `Task` lifecycle: task creation, the single-source-of-truth state
machine, and its public service. The dispatch loop, linear workflow runner, and
retry/failure taxonomy — the code-generation drivers — are **retired**.

**Status:** review-reorient — state machine + `TaskService` retained; dispatch /
workflow / retry removed. ·
**Boundary rule:** engine — imports only shared packages (`@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`).

---

## Purpose

1. **Create tasks** — the smallest indivisible unit of work, keyed by UUIDv7.
2. **Own the state machine** — the one place that decides which transitions are legal (no transition logic lives anywhere else).
3. **Record history** — every transition is an append-only `task_state_history` row.

> The state machine **is** the spec. What was removed is only the *driver* that
> pulled `PENDING`/`REWORK` tasks through a code-gen workflow — the review slice
> creates a task to anchor provenance and immediately `CANCELLED`s it.

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

## Core data shapes

| Type | What it is |
| --- | --- |
| `TaskRecord` | Typed view of a persisted `tasks` row (`id`, `projectId`, `title`, `state`, `attemptNumber`, `maxAttempts`, `assignedAgent`, `idempotencyKey`, timestamps). |
| `CreateTaskParams` | Minimal create input (`projectId`, `title`, `description?`, `maxAttempts?` → default 3). |
| `TaskStateHistoryEntry` | One `task_state_history` audit-trail row: `fromState`, `toState`, `triggeredBy`, `triggerEventId`, `rationale`, `attemptNumber`. |

---

## Modules

| Module | What it provides |
| --- | --- |
| `state-machine/task-state-machine.ts` | `TaskStateMachine` — `canTransition`, `legalTargets`, `isTerminal`, `requiresRationale`. |
| `state-machine/errors.ts` | `IllegalTransitionError`, `MissingRationaleError`, `StateConflictError`, `TerminalStateError`. |
| `task-service.ts` | `TaskService` — validated `transitionTask()` (guards against version skew via `StateConflictError`) + `TransitionOptions`. |
| `types.ts` | `CreateTaskParams`, `TaskRecord`, `TaskStateHistoryEntry`. |

Retired (removed from the barrel): `dispatch/` (`Dispatcher`, `DispatchLoop`),
`workflow/` (`WorkflowRunner`, step handlers, `LINEAR_WORKFLOW_V1`), and `retry/`
(`FailureClass`, `classifyError`, `DEFAULT_RETRY_POLICY`).

---

## Interaction with other packages

```text
            Tasks / transitions / events  (publishes task.*;
            consumed by subscribers via the bus)
                          ▲
                          │ @harness/event-bus
                          │
        ┌─────────────────┼──────────────────────┐
        ▼                 ▼                      ▼
   review            auto-approve            review-ingest
   (decide)           (auto_approve)          (createTask → CANCELLED anchor)
```

The orchestrator never imports another engine — callers advance the state machine
through `TaskService`, and the bus fan-out handles the side effects. `TaskTrigger`
records the actor: `orchestrator` | `agent_runtime` | `verification_engine` |
`auto_approve` | `human`.

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
└── state-machine/
    ├── task-state-machine.ts     # the transition table
    └── errors.ts
```

## Public API surface

```typescript
// state machine + errors
TaskStateMachine, IllegalTransitionError, MissingRationaleError,
StateConflictError, TerminalStateError
// service
TaskService, TransitionOptions
// types
CreateTaskParams, TaskRecord, TaskStateHistoryEntry
```

## Wiring

`TaskService` and `TaskStateMachine` are registered in `apps/api/src/bootstrap.ts`
and resolved by the review backend (`ReviewService`), the auto-approve executor,
and the review ingest slice.