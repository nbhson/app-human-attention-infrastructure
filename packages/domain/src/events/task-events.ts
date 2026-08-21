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

/** How an agent run ended (day-12 §2.6). */
export type AgentExecutionOutcome = 'COMPLETED' | 'ESCALATED';

/** Payload for {@link import('./event-types.js').EventType.TaskExecutionFinished}. */
export interface TaskExecutionFinishedPayload {
  /** The task that finished executing. */
  readonly task_id: TaskID;
  /** The agent run that executed it. */
  readonly agent_run_id: AgentRunID;
  /** Terminal outcome: `COMPLETED` (end_turn) or `ESCALATED` (max_steps/token budget). */
  readonly outcome: AgentExecutionOutcome;
  /** Total execution duration in milliseconds. */
  readonly duration_ms: number;
}

/** Payload for {@link import('./event-types.js').EventType.TaskFailed}. */
export interface TaskFailedPayload {
  /** The task that failed terminally. */
  readonly task_id: TaskID;
  /** Why the task failed (e.g. `MAX_ATTEMPTS_EXHAUSTED`). */
  readonly reason: string;
}
