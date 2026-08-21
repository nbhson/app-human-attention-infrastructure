/**
 * Orchestrator read/write model types (day-06).
 *
 * The rich `Task` interface in `@harness/domain` is the in-memory/read model
 * consumed by other engines; the `tasks` table (day-04) is the minimal
 * current-state projection. `TaskRecord` is the typed view of that projection
 * that `TaskService` returns — it does not invent fields the table doesn't store.
 */

import type { EventID, ProjectID, TaskID, TaskStatus, TaskTrigger } from '@harness/domain';

/** A persisted `tasks` row, with branded IDs and the `TaskStatus` union. */
export interface TaskRecord {
  readonly id: TaskID;
  readonly projectId: ProjectID;
  readonly title: string;
  readonly description: string | null;
  readonly state: TaskStatus;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly assignedAgent: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Input accepted by {@link import('./task-service.js').TaskService.createTask}. */
export interface CreateTaskParams {
  readonly id?: TaskID;
  readonly projectId: ProjectID;
  readonly title: string;
  readonly description?: string | null;
  /** Re-dispatch bound (day-08 §2.4). Defaults to 3 when omitted. */
  readonly maxAttempts?: number;
}

/** One row of the `task_state_history` audit trail (day-06 §2.3). */
export interface TaskStateHistoryEntry {
  readonly id: string;
  readonly taskId: TaskID;
  readonly fromState: TaskStatus;
  readonly toState: TaskStatus;
  readonly triggeredBy: TaskTrigger;
  readonly triggerEventId: EventID | null;
  readonly rationale: string | null;
  readonly attemptNumber: number;
  readonly occurredAt: Date;
}
