/**
 * Task lifecycle event payloads (orchestrator spec §8).
 */

import type { AgentRunID, TaskID, WorkflowID } from '../ids.js';
import type { Priority, TaskStatus } from '../task.js';

/** Who triggered a task state change. */
export type TaskTrigger = 'orchestrator' | 'agent_runtime' | 'verification_engine' | 'human';

/** Payload for {@link import('./event-types.js').EventType.TaskCreated}. */
export interface TaskCreatedPayload {
  /** The new task. */
  readonly task_id: TaskID;
  /** The workflow it belongs to. */
  readonly workflow_id: WorkflowID;
  /** Short task name. */
  readonly name: string;
  /** Task priority. */
  readonly priority: Priority;
}

/** Payload for {@link import('./event-types.js').EventType.TaskStateChanged}. */
export interface TaskStateChangedPayload {
  /** The task that transitioned. */
  readonly task_id: TaskID;
  /** State before the transition. */
  readonly from_state: TaskStatus;
  /** State after the transition. */
  readonly to_state: TaskStatus;
  /** Who triggered the transition. */
  readonly triggered_by: TaskTrigger;
  /** 1-based attempt number. */
  readonly attempt_number: number;
}

/** Payload for {@link import('./event-types.js').EventType.TaskExecutionFinished}. */
export interface TaskExecutionFinishedPayload {
  /** The task that finished executing. */
  readonly task_id: TaskID;
  /** The agent run that executed it. */
  readonly agent_run_id: AgentRunID;
  /** Terminal task status. */
  readonly status: TaskStatus;
  /** Total execution duration in milliseconds. */
  readonly duration_ms: number;
}
