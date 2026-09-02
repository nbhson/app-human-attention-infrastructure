/**
 * Transition errors (day-06 §3.3).
 *
 * These are the *only* public validation failures `TaskService` can raise for a
 * transition. Illegal moves are rejected loudly — never a silent no-op.
 */

import type { TaskID, TaskStatus as TaskState } from '@harness/domain';

/** Base class for every "that transition is not allowed" failure. */
export class IllegalTransitionError extends Error {
  readonly taskId: TaskID;
  readonly fromState: TaskState;
  readonly toState: TaskState;
  readonly legalTargets: readonly TaskState[];

  constructor(taskId: TaskID, fromState: TaskState, toState: TaskState, legalTargets: readonly TaskState[]) {
    const targets = legalTargets.join(', ') || '(none — terminal)';
    super(
      `Illegal transition for task ${taskId}: ${fromState} -> ${toState}. Legal targets from ${fromState}: ${targets}.`,
    );
    this.name = 'IllegalTransitionError';
    this.taskId = taskId;
    this.fromState = fromState;
    this.toState = toState;
    this.legalTargets = legalTargets;
  }
}

/** A transition attempted from a terminal state (`COMPLETED` / `CANCELLED`). */
export class TerminalStateError extends IllegalTransitionError {
  constructor(taskId: TaskID, fromState: TaskState, toState: TaskState, legalTargets: readonly TaskState[]) {
    super(taskId, fromState, toState, legalTargets);
    this.name = 'TerminalStateError';
  }
}

/** Two writers raced; the optimistic-lock UPDATE matched zero rows. */
export class StateConflictError extends Error {
  readonly taskId: TaskID;
  readonly expectedState: TaskState;
  readonly actualState: TaskState;

  constructor(taskId: TaskID, expectedState: TaskState, actualState: TaskState) {
    super(`State conflict for task ${taskId}: expected ${expectedState} but it is already ${actualState}.`);
    this.name = 'StateConflictError';
    this.taskId = taskId;
    this.expectedState = expectedState;
    this.actualState = actualState;
  }
}

/** A human-driven transition that was attempted without a rationale. */
export class MissingRationaleError extends Error {
  readonly fromState: TaskState;
  readonly toState: TaskState;

  constructor(fromState: TaskState, toState: TaskState) {
    super(`Transition ${fromState} -> ${toState} requires a rationale.`);
    this.name = 'MissingRationaleError';
    this.fromState = fromState;
    this.toState = toState;
  }
}
