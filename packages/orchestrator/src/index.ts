/**
 * `@harness/orchestrator` — the Task / Work Orchestrator.
 *
 * Day 06 ships the canonical state machine and its public service. The dispatch
 * loop (Day 08) and higher-level orchestration build on `TaskService`.
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
