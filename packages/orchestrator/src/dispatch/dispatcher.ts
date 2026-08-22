/**
 * `Dispatcher` — moves `PENDING`/`REWORK` tasks to `QUEUED` (or `FAILED` when an
 * attempt is exhausted), using PostgreSQL as a pull-based queue (day-08 §2).
 *
 * The claim step runs inside a single transaction: `SELECT ... FOR UPDATE SKIP
 * LOCKED` atomically picks the batch, and each pick is *reserved* with a
 * `dispatch_log` insert in the same transaction. That reservation — enforced by
 * the unique `idempotency_key` (`task_id:attempt_number`, §2.3) — is what makes a
 * duplicate or concurrent dispatch a no-op even if two pollers overlap between
 * this transaction committing and the state transition below.
 *
 * The state change itself is delegated to {@link TaskService.transitionTask}, so
 * the history row and the `task.state_changed` event are written by the one code
 * path that owns transitions. The `Dispatcher` never touches Agent Runtime
 * directly (§2.2): the event *is* the notification, and the runtime pulls.
 */

import { asc, eq, or } from 'drizzle-orm';

import { brand, EventType, TaskStatus, uuidv7 } from '@harness/domain';
import type { TaskFailedPayload } from '@harness/domain';
import { dispatchLog, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { withSpan } from '@harness/observability';

import { TaskService } from '../task-service.js';

/** Per-tick outcome (day-08 §3.2). */
export interface DispatchResult {
  /** Transitions to `QUEUED` performed this tick. */
  readonly dispatched: number;
  /** Candidates already dispatched (idempotency skip, §2.3). */
  readonly skipped: number;
  /** Exhausted `REWORK` tasks routed to `FAILED` (§2.4). */
  readonly failed: number;
}

/** A task claimed by the dispatch transaction, pending its transition. */
interface Claim {
  readonly id: string;
  readonly exhausted: boolean;
}

export class Dispatcher {
  constructor(
    private readonly db: DrizzleDB,
    private readonly taskService: TaskService,
    private readonly bus: IEventBus,
  ) {}

  /**
   * Poll the queue once: claim up to `batchSize` `PENDING`/`REWORK` tasks and
   * drive each to its next state.
   */
  async dispatchPending(batchSize = 10): Promise<DispatchResult> {
    // Mutable accumulator; structurally returned as an immutable DispatchResult.
    const result = { dispatched: 0, skipped: 0, failed: 0 };

    // Phase 1 — claim. `SKIP LOCKED` + `FOR UPDATE` only hold the lock inside a
    // transaction (day-08 §6), so the select *and* the reservation insert run
    // together here. Anything we do not reserve now, we must not transition.
    const claims: Claim[] = [];

    await this.db.transaction(async (tx) => {
      // §2.1. Note: REWORK is picked up *without* filtering on `max_attempts` so
      // exhausted attempts can be routed to FAILED (§2.4) rather than orphaned.
      const candidates = await tx
        .select()
        .from(tasks)
        .where(or(eq(tasks.state, TaskStatus.Pending), eq(tasks.state, TaskStatus.Rework)))
        .orderBy(asc(tasks.created_at))
        .limit(batchSize)
        .for('update', { skipLocked: true });

      for (const row of candidates) {
        // A REWORK task is dispatched for its *next* attempt: `attempt_number`
        // bumps on the REWORK→QUEUED transition (day-06 §2.5), so keying the
        // reservation on the pre-bump value would collide with the initial
        // PENDING→QUEUED dispatch of the same attempt (both `id:0`) and silently
        // skip the re-dispatch. Key on the attempt being launched instead.
        const dispatchAttempt =
          row.state === TaskStatus.Rework ? row.attempt_number + 1 : row.attempt_number;
        const key = `${row.id}:${dispatchAttempt}`;

        // Reserve the dispatch. `onConflictDoNothing().returning()` yields a row
        // only when *we* won the claim; an empty result means someone else (a
        // concurrent poller, or a prior tick) already logged this task:attempt.
        const inserted = await tx
          .insert(dispatchLog)
          .values({
            id: uuidv7(),
            task_id: row.id,
            attempt_number: dispatchAttempt,
            idempotency_key: key,
            dispatched_at: new Date(),
          })
          .onConflictDoNothing()
          .returning({ id: dispatchLog.id });

        if (inserted.length === 0) {
          result.skipped += 1;
          continue;
        }

        claims.push({
          id: row.id,
          exhausted: row.state === TaskStatus.Rework && row.attempt_number >= row.max_attempts,
        });
      }
    });

    // Phase 2 — transition, outside the transaction so `TaskService` writes
    // history and publishes events through its own connection. The claim is
    // already durable in `dispatch_log`, so re-entrancy here is harmless.
    for (const claim of claims) {
      const toState = claim.exhausted ? TaskStatus.Failed : TaskStatus.Queued;
      const taskId = brand(claim.id, 'TaskID');
      // `task.id` IS the correlation id (day-27 §2.2), and the dispatch loop
      // runs off a poll timer with no ambient context, so bind it here (day-03
      // §2.1 — the store leaks across await, but not across a loop tick).
      await withSpan(
        {
          spanName: 'task.dispatch',
          ctx: { correlationId: claim.id, taskId },
          attributes: { 'harness.task.exhausted': claim.exhausted },
        },
        () => this.taskService.transitionTask(taskId, toState, 'orchestrator'),
      );
      if (claim.exhausted) {
        // An exhausted REWORK reaching FAILED by max-attempts is a terminal
        // failure too (§2.4): publish `task.failed` so downstream observers
        // (day-26 §2.1 scenario 2) see one catch-all failure signal, mirroring
        // the ReworkService's reject-path publisher (day-24 §2.2).
        const payload: TaskFailedPayload = { task_id: taskId, reason: 'MAX_ATTEMPTS_EXHAUSTED' };
        this.bus.publish(
          createEvent(EventType.TaskFailed, brand(claim.id, 'CorrelationID'), payload),
        );
        result.failed += 1;
      } else {
        result.dispatched += 1;
      }
    }

    return result;
  }
}
