# Idempotency Audit

> **Day 10 §3.6.** Every production `INSERT` in the codebase, checked against a
> dedup guard so that a repeated write degrades to a no-op instead of corrupting
> state. Updated: Day 10; hardened post-`v0.6.0-harness` (decision `dedup_key`
> `NOT NULL` + migration `0051`, SQL `NOT EXISTS` pending filter, full-hex
> write-back intent ids — see rows below).

The rule of thumb: **an insert either has a natural key that makes duplicates
impossible, or a `ON CONFLICT DO NOTHING` clause — otherwise it is flagged here
as a deliberate exception.**

## Inventory

| Table                | Writer                                                                                            | Guard                                                                                                                                | Notes                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event_log`          | `EventLogWriter.write` (`packages/db/src/event-log-writer.ts`)                                    | `onConflictDoNothing()` on PK `event_id`                                                                                             | Append-only; a redelivered event is silently dropped.                                                                                                                                                                             |
| `dispatch_log`       | ~~`Dispatcher.dispatchPending`~~ (retired `review-reorient`)                                      | `onConflictDoNothing()` on unique `idempotency_key` (`task_id:attempt_number`)                                                       | The table remains; no live writer — the dispatch loop was retired with code-gen.                                                                                                                                                  |
| `task_state_history` | `TaskService.transitionTask` (`packages/orchestrator/src/task-service.ts`)                        | Optimistic-lock UPDATE **before** the insert                                                                                         | The `UPDATE … WHERE state = expectedFrom` returns zero rows on a concurrent change → `StateConflictError`, so a duplicate transition row is never written.                                                                        |
| `task_step_log`      | ~~`WorkflowRunner.run`~~ (retired `review-reorient`)                                              | No natural key — **accepted**                                                                                                        | The table remains; no live writer (the workflow runner was retired).                                                                                                                                                              |
| `retry_log`          | ~~`WorkflowRunner.insertRetryLog`~~ (retired `review-reorient`)                                   | No natural key — **accepted**                                                                                                        | The table remains; no live writer (the retry/logic taxonomy was retired).                                                                                                                                                         |
| `tasks`              | `TaskService.createTask` (`task-service.ts`)                                                      | Fresh UUIDv7 PK (and caller-supplied `input.id`)                                                                                     | No `ON CONFLICT`: a fresh UUID can't collide. Callers wanting idempotent creation pass a stable `id`.                                                                                                                             |
| `review_reports`     | `ReviewIngestService.ingest` (get-or-create project + fresh report id)                            | Fresh UUIDv7 PK                                                                                                                      | The owning `projects` row is get-or-create on `repo_path` (idempotent); the report/findings/suggestions rows use fresh UUIDs.                                                                                                     |
| `writeback_log` | `MCPWriteBack.write` → `DrizzleWritebackLogStore.claim`/`finalize` (the `WritebackLogStore` port) | Claim-then-write + unique partial index `writeback_log_dedup_inflight_uniq` ON `dedup_key` WHERE status is PENDING or SUCCEEDED | A retried or racing identical intent is caught at claim time and marked `DUPLICATE` — exactly one external write per key (day-08, hardened day-36). Intent ids are deterministic full sha256 hex per decision, so decision retries reuse the same key. |
| `review_decisions` | `routes/reviews.ts` (`POST /api/reviews/:id/decision`) | `NOT NULL` unique `dedup_key` (sha256 over report + decision + rationale + comment + writeback flag; migration `0051`, legacy rows backfilled) + pre-check + catch-unique-race | `NOT NULL` is load-bearing: Postgres unique indexes admit multiple NULLs, so a nullable key would silently bypass dedup. Same-payload double-clicks and retries return the existing row (`deduped:true`); comment-then-status runs saga-style with 207 partial so a retry resumes only the missing leg (P0 fix). |
| `projects`           | `seed.ts`                                                                                         | `onConflictDoNothing()`                                                                                                              | Dev-time fixture only; re-running the seed is a no-op.                                                                                                                                                                            |

## Exceptions (no guard, deliberate)

- **`task_step_log`** and **`retry_log`** are append-only audit trails where a
  duplicate row is harmless and a natural key either does not exist or would
  force artificial complexity (a deliberate day-10 §2.5 trade-off).

## Potential future changes

- `event_log` moves to a durable write queue (fire-and-forget today admits a
  lost line under crash).
- `task_step_log` / `retry_log` may gain a `is_last` flag or an event-sourced
  `aggregate_id` once resume-from-crash needs to distinguish in-flight from
  terminal rows.
