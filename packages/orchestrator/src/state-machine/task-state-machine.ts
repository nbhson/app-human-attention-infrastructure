/**
 * The single source of truth for Task state transitions (day-06 §2.2).
 *
 * The `TaskStatus` union lives in `@harness/domain` (mirrored by the
 * `tasks_state_check` CHECK constraint in Postgres); this class owns *which*
 * moves are legal. No transition logic may live anywhere else.
 */

import { TaskStatus } from '@harness/domain';
import type { TaskStatus as TaskState } from '@harness/domain';

/**
 * The legal transition table (day-06 §2.2). The transition *is* the spec —
 * when in doubt, reject rather than infer.
 *
 * `RETRYING` is a defined state (orchestrator spec §3) whose enter/exit
 * transitions are added on Day 10 (retry, failure, idempotency). Until then it
 * is unreachable: it appears in no `Set` below.
 */
const TRANSITIONS: ReadonlyMap<TaskState, ReadonlySet<TaskState>> = new Map([
  [TaskStatus.Pending, new Set([TaskStatus.Queued, TaskStatus.Cancelled])],
  [TaskStatus.Queued, new Set([TaskStatus.Executing, TaskStatus.Cancelled])],
  [
    TaskStatus.Executing,
    new Set([TaskStatus.Verifying, TaskStatus.Failed, TaskStatus.AwaitingHumanIntervention]),
  ],
  [
    TaskStatus.Verifying,
    new Set([
      TaskStatus.AwaitingReview,
      TaskStatus.Rework,
      TaskStatus.Failed,
      // Recovery path (day-28 F4): a VERIFYING task orphaned by a crash is moved
      // to human attention by the startup reconciler, mirroring EXECUTING → AHI.
      TaskStatus.AwaitingHumanIntervention,
    ]),
  ],
  [TaskStatus.AwaitingReview, new Set([TaskStatus.Approved, TaskStatus.Rejected])],
  // APPROVED → AWAITING_HUMAN_INTERVENTION is the merge-failure escape hatch
  // (day-24 §2.1); APPROVED → COMPLETED is the "artifact merged" move.
  [TaskStatus.Approved, new Set([TaskStatus.Completed, TaskStatus.AwaitingHumanIntervention])],
  // REJECTED → FAILED is the max-attempts terminus (day-24 §2.2).
  [TaskStatus.Rejected, new Set([TaskStatus.Rework, TaskStatus.Failed, TaskStatus.Cancelled])],
  [TaskStatus.Rework, new Set([TaskStatus.Queued, TaskStatus.Cancelled, TaskStatus.Failed])],
  [TaskStatus.Completed, new Set()],
  [TaskStatus.Failed, new Set([TaskStatus.Queued, TaskStatus.Cancelled])],
  [TaskStatus.AwaitingHumanIntervention, new Set([TaskStatus.Queued, TaskStatus.Cancelled])],
  [TaskStatus.Cancelled, new Set()],
  [TaskStatus.Retrying, new Set()],
]);

/**
 * Human-driven transitions (day-06 §2.2 "Trigger" column). These require a
 * `rationale` on the history record. `APPROVED → COMPLETED` is *not* human
 * (it is "artifact merged"), so it is absent by definition.
 */
const RATIONALE_REQUIRED: ReadonlySet<string> = new Set([
  key(TaskStatus.Pending, TaskStatus.Cancelled),
  key(TaskStatus.Queued, TaskStatus.Cancelled),
  key(TaskStatus.AwaitingReview, TaskStatus.Approved),
  key(TaskStatus.AwaitingReview, TaskStatus.Rejected),
  key(TaskStatus.Rework, TaskStatus.Cancelled),
  key(TaskStatus.Rejected, TaskStatus.Rework),
  key(TaskStatus.Rejected, TaskStatus.Cancelled),
  key(TaskStatus.AwaitingHumanIntervention, TaskStatus.Queued),
  key(TaskStatus.AwaitingHumanIntervention, TaskStatus.Cancelled),
  key(TaskStatus.Failed, TaskStatus.Queued),
  key(TaskStatus.Failed, TaskStatus.Cancelled),
]);

/** Stable string key for a `(from, to)` pair. */
function key(from: TaskState, to: TaskState): string {
  return `${from}->${to}`;
}

export class TaskStateMachine {
  /** Whether `from → to` is a legal transition. */
  canTransition(from: TaskState, to: TaskState): boolean {
    return TRANSITIONS.get(from)?.has(to) ?? false;
  }

  /** Every state legally reachable from `from`, in table order. */
  legalTargets(from: TaskState): TaskState[] {
    return [...(TRANSITIONS.get(from) ?? new Set<TaskState>())];
  }

  /** Whether `state` is terminal (no outgoing transition ever). */
  isTerminal(state: TaskState): boolean {
    return state === TaskStatus.Completed || state === TaskStatus.Cancelled;
  }

  /** Whether `from → to` requires a human rationale. */
  requiresRationale(from: TaskState, to: TaskState): boolean {
    return RATIONALE_REQUIRED.has(key(from, to));
  }
}
