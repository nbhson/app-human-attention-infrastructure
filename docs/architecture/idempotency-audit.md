# Idempotency Audit

> **Day 10 §3.6.** Every production `INSERT` in the codebase, checked against a
> dedup guard so that a repeated write degrades to a no-op instead of corrupting
> state. Updated: Day 10.

The rule of thumb: **an insert either has a natural key that makes duplicates
impossible, or a `ON CONFLICT DO NOTHING` clause — otherwise it is flagged here
as a deliberate exception.**

## Inventory

| Table | Writer | Guard | Notes |
|---|---|---|---|
| `event_log` | `EventLogWriter.write` (`packages/db/src/event-log-writer.ts`) | `onConflictDoNothing()` on PK `event_id` | Append-only; a redelivered event is silently dropped. |
| `dispatch_log` | `Dispatcher.dispatchPending` (`packages/orchestrator/src/dispatch/dispatcher.ts`) | `onConflictDoNothing()` on unique `idempotency_key` (`task_id:attempt_number`) | The atomic claim: two pollers reserving the same attempt see one win, one no-op. |
| `task_state_history` | `TaskService.transitionTask` (`packages/orchestrator/src/task-service.ts`) | Optimistic-lock UPDATE **before** the insert | The `UPDATE … WHERE state = expectedFrom` returns zero rows on a concurrent change → `StateConflictError`, so a duplicate transition row is never written. |
| `task_step_log` | `WorkflowRunner.run` (`packages/orchestrator/src/workflow/workflow-runner.ts`) | No natural key — **accepted** | Each step run is a fresh UUIDv7 row (`STARTED` → `COMPLETED`/`FAILED`). Re-running a step intentionally writes a new row; there is nothing to dedup against. |
| `retry_log` | `WorkflowRunner.insertRetryLog` | No natural key — **accepted** | Each retry is a distinct audit event; duplicates are not a correctness hazard. |
| `tasks` | `TaskService.createTask` (`task-service.ts`) | Fresh UUIDv7 PK (and caller-supplied `input.id`) | No `ON CONFLICT`: a fresh UUID can't collide. Callers wanting idempotent creation pass a stable `id`. |
| `projects` | `seed.ts` | `onConflictDoNothing()` | Dev-time fixture only; re-running the seed is a no-op. |

## Exceptions (no guard, deliberate)

- **`task_step_log`** and **`retry_log`** are append-only audit trails where a
  duplicate row is harmless and a natural key either does not exist or would
  force artificial complexity (Phase 1 trade-off, day-10 §2.5).

## What would change in Phase 2

- `event_log` moves to a durable write queue (fire-and-forget today admits a
  lost line under crash).
- `task_step_log` / `retry_log` may gain a `is_last` flag or an event-sourced
  `aggregate_id` once resume-from-crash needs to distinguish in-flight from
  terminal rows.