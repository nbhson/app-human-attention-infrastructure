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

export { Dispatcher } from './dispatch/dispatcher.js';
export type { DispatchResult } from './dispatch/dispatcher.js';
export { DispatchLoop } from './dispatch/dispatch-loop.js';
export type { DispatchLoopLogger } from './dispatch/dispatch-loop.js';

export { StepKind, LINEAR_WORKFLOW_V1 } from './workflow/workflow-definition.js';
export type { WorkflowDefinition, WorkflowStep } from './workflow/workflow-definition.js';
export type { StepContext, StepHandler, StepResult } from './workflow/step-handler.js';
export { WorkflowRunner } from './workflow/workflow-runner.js';

export type { CreateTaskParams, TaskRecord, TaskStateHistoryEntry } from './types.js';
