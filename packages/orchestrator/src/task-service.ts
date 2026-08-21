/**
 * `TaskService` — the only public API for changing a task's state (day-06 §3.4).
 *
 * Every other subsystem drives transitions *through* this service, never around
 * it. Each successful transition validates against the {@link TaskStateMachine},
 * writes an audit row to `task_state_history`, and publishes `task.state_changed`
 * on the bus — so provenance (day-26) and observability (day-27) read one
 * consistent trail.
 */

import { and, asc, eq } from 'drizzle-orm';

import { brand, EventType, newTaskID, TaskStatus, uuidv7 } from '@harness/domain';
import type {
  EventID,
  TaskID,
  TaskStatus as TaskState,
  TaskStateChangedPayload,
  TaskTrigger,
} from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { tasks, taskStateHistory } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import {
  IllegalTransitionError,
  MissingRationaleError,
  StateConflictError,
  TerminalStateError,
} from './state-machine/errors.js';
import { TaskStateMachine } from './state-machine/task-state-machine.js';
import type { CreateTaskParams, TaskRecord, TaskStateHistoryEntry } from './types.js';

/** Optional transition metadata (day-06 §3.4 / §6). */
export interface TransitionOptions {
  /** Required for human-driven transitions (see `TaskStateMachine.requiresRationale`). */
  readonly rationale?: string;
  /** The event that caused this transition, if any. */
  readonly triggerEventId?: EventID;
  /**
   * The caller's assumed current state, used as the optimistic-lock guard. When
   * omitted, it defaults to the freshly-read state. Pass a stale value to force
   * a {@link StateConflictError} rather than silently double-transitioning.
   */
  readonly expectedFrom?: TaskState;
}

type TaskRow = typeof tasks.$inferSelect;
type HistoryRow = typeof taskStateHistory.$inferSelect;

/** Map a persisted snake_case row onto the branded, camelCase read model. */
function toRecord(row: TaskRow): TaskRecord {
  return {
    id: brand(row.id, 'TaskID'),
    projectId: brand(row.project_id, 'ProjectID'),
    title: row.title,
    description: row.description,
    state: row.state as TaskState,
    attemptNumber: row.attempt_number,
    maxAttempts: row.max_attempts,
    assignedAgent: row.assigned_agent,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Map a `task_state_history` row onto the read model. */
function toHistoryEntry(row: HistoryRow): TaskStateHistoryEntry {
  return {
    id: row.id,
    taskId: brand(row.task_id, 'TaskID'),
    fromState: row.from_state as TaskState,
    toState: row.to_state as TaskState,
    triggeredBy: row.triggered_by as TaskTrigger,
    triggerEventId: row.trigger_event_id ? brand(row.trigger_event_id, 'EventID') : null,
    rationale: row.rationale,
    attemptNumber: row.attempt_number,
    occurredAt: row.occurred_at,
  };
}

export class TaskService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly sm: TaskStateMachine,
  ) {}

  /** Insert a new task in `PENDING`, attempt 0. */
  async createTask(input: CreateTaskParams): Promise<TaskRecord> {
    const id = input.id ?? newTaskID();
    const attemptNumber = 0;

    const rows = await this.db
      .insert(tasks)
      .values({
        id,
        project_id: input.projectId,
        title: input.title,
        description: input.description ?? null,
        state: TaskStatus.Pending,
        attempt_number: attemptNumber,
        max_attempts: input.maxAttempts ?? 3,
        assigned_agent: null,
        idempotency_key: `${id}:${attemptNumber}`,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error(`createTask: no row returned for task ${id}`);
    }
    return toRecord(row);
  }

  /**
   * Transition a task to `toState`, atomically guarded by an optimistic lock.
   *
   * Steps (day-06 §3.4): load → validate → rationale → requeue bookkeeping →
   * optimistic UPDATE → history insert → publish `task.state_changed`.
   */
  async transitionTask(
    taskId: TaskID,
    toState: TaskState,
    triggeredBy: TaskTrigger,
    opts?: TransitionOptions,
  ): Promise<TaskRecord> {
    const current = await this.getTask(taskId);
    if (!current) {
      throw new Error(`task not found: ${taskId}`);
    }

    const from = opts?.expectedFrom ?? current.state;

    if (!this.sm.canTransition(from, toState)) {
      if (this.sm.isTerminal(from)) {
        throw new TerminalStateError(taskId, from, toState, this.sm.legalTargets(from));
      }
      throw new IllegalTransitionError(taskId, from, toState, this.sm.legalTargets(from));
    }

    if (this.sm.requiresRationale(from, toState) && !opts?.rationale) {
      throw new MissingRationaleError(from, toState);
    }

    // `REWORK → QUEUED` is the attempt boundary: it bumps the attempt count and
    // regenerates the idempotency key (day-06 §2.5). Every other move preserves both.
    const isRequeue = from === TaskStatus.Rework && toState === TaskStatus.Queued;
    const nextAttempt = isRequeue ? current.attemptNumber + 1 : current.attemptNumber;
    const nextIdempotencyKey = isRequeue ? `${taskId}:${nextAttempt}` : current.idempotencyKey;

    const updated = await this.db
      .update(tasks)
      .set({
        state: toState,
        attempt_number: nextAttempt,
        idempotency_key: nextIdempotencyKey,
        updated_at: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.state, from)))
      .returning();

    const row = updated[0];
    if (!row) {
      // Another writer changed the state out from under us (day-06 §2.4).
      throw new StateConflictError(taskId, from, current.state);
    }

    await this.db.insert(taskStateHistory).values({
      id: uuidv7(),
      task_id: taskId,
      from_state: from,
      to_state: toState,
      triggered_by: triggeredBy,
      trigger_event_id: opts?.triggerEventId ?? null,
      rationale: opts?.rationale ?? null,
      attempt_number: nextAttempt,
      occurred_at: new Date(),
    });

    const payload: TaskStateChangedPayload = {
      task_id: taskId,
      from_state: from,
      to_state: toState,
      triggered_by: triggeredBy,
      attempt_number: nextAttempt,
    };
    this.bus.publish(
      createEvent(EventType.TaskStateChanged, brand(taskId, 'CorrelationID'), payload),
    );

    return toRecord(row);
  }

  /** Read the current-state projection of a task, or `null` if absent. */
  async getTask(taskId: TaskID): Promise<TaskRecord | null> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  /** Read the full audit trail for a task, oldest first. */
  async getTaskHistory(taskId: TaskID): Promise<TaskStateHistoryEntry[]> {
    const rows = await this.db
      .select()
      .from(taskStateHistory)
      .where(eq(taskStateHistory.task_id, taskId))
      .orderBy(asc(taskStateHistory.occurred_at), asc(taskStateHistory.id));
    return rows.map(toHistoryEntry);
  }
}
