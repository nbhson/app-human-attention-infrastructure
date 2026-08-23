/**
 * `@harness/orchestrator` — the Task / Work Orchestrator.
 *
 * Ships the canonical task state machine and its public service. The
 * code-generation dispatch/workflow/retry loop was retired in the
 * review-reorient pivot — the review slice reaches the machine through
 * `TaskService` directly.
 */

export { TaskStateMachine } from './state-machine/task-state-machine.js';
export {
  IllegalTransitionError,
  MissingRationaleError,
  StateConflictError,
  TerminalStateError,
} from './state-machine/errors.js';

export { TaskService } from './task-service.js';
export type { TransitionOptions } from './task-service.js';

export type { CreateTaskParams, TaskRecord, TaskStateHistoryEntry } from './types.js';
