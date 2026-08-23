# Day 06 — Canonical Task state machine (13 states)

| | |
|---|---|
| **Week** | W1 — Foundation |
| **Spec refs** | Spec 2 §3 (state machine), Spec 1 §7 (single source of truth) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 05 (DI + boundaries + `@harness/db`) |

---

## 1. Objectives

- Implement `@harness/orchestrator`'s `TaskStateMachine` — the one place that decides legal transitions across the **13-state** `TaskStatus` union.
- Provide `TaskService` with validated `transitionTask()` (guarded against version skew) and append-only `task_state_history` recording.
- Require a `rationale` on human-driven / terminal hand-off transitions, and reject unknown transitions (`IllegalTransitionError`).
- Publish `task.created` and `task.state_changed` events on the bus, with the transition actor recorded.

## 2. Design Decisions

- The transition table **is** the spec: reject rather than infer. The 13 states are `PENDING`, `QUEUED`, `EXECUTING`, `VERIFYING`, `AWAITING_REVIEW`, `APPROVED`, `REJECTED`, `REWORK`, `COMPLETED`, `FAILED`, `AWAITING_HUMAN_INTERVENTION`, `CANCELLED`, `RETRYING`.
- The **review slice creates a task only to anchor provenance and immediately drives it to `CANCELLED`** — it does not run the retired `EXECUTING → VERIFYING → …` code-generation workflow. The state machine is retained for identity + audit, not for dispatch.

```ts
// representative legal edge (terminal + CANCELLED emphasised)
// PENDING → QUEUED | CANCELLED
// AWAITING_REVIEW → APPROVED | REJECTED
// COMPLETED, CANCELLED → (terminal)
```

- No dispatch loop, workflow runner, or retry taxonomy is built: those drivers are retired. `RETRYING` exists in the union but has no inbound edge in the review slice.

## 3. Tasks

### 3.1 State machine (150 min)
- [ ] `state-machine/task-state-machine.ts` — `canTransition`, `legalTargets`, `isTerminal`, `requiresRationale`
- [ ] `state-machine/errors.ts` — `IllegalTransitionError`, `MissingRationaleError`, `StateConflictError`, `TerminalStateError`
- [ ] Exhaustive table test over all 13×13 pairs

### 3.2 TaskService (150 min)
- [ ] `task-service.ts` — `createTask`, `transitionTask` (optimistic version guard), `getTask`
- [ ] `task_state_history` writes with `fromState`/`toState`/`rationale`/`triggeredBy`

### 3.3 Events + wiring (120 min)
- [ ] Publish `task.created` / `task.state_changed` on the bus
- [ ] Register `TaskService` in the DI container; integration test with `@harness/db`

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/orchestrator/src/state-machine/task-state-machine.ts` | Transition table |
| `packages/orchestrator/src/state-machine/errors.ts` | Transition error types |
| `packages/orchestrator/src/task-service.ts` | `TaskService` + history recording |
| `packages/orchestrator/src/types.ts` | `CreateTaskParams`, `TaskRecord`, history entry |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/orchestrator test` passes
- [ ] Every legal/illegal (from,to) pair returns exactly as the table specifies; terminals reject all moves
- [ ] `PENDING → CANCELLED` succeeds with a rationale; `AWAITING_REVIEW → APPROVED` without one throws `MissingRationaleError`
- [ ] `task.state_changed` carries `correlation_id` and lands an append-only history row

## 6. Notes & Pitfalls

- Do **not** narrate or rebuild the retired dispatch/workflow/retry drivers under any name — the review slice treats the task as a provenance anchor only.
- The state machine is "reject, don't infer": an unlisted transition must throw, not silently pass.

---

*Next: [Day 07 — Week 1 checkpoint — E2E smoke test](day-07.md)*