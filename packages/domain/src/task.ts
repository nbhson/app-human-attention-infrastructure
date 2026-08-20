/**
 * Task and workflow domain types.
 *
 * The Task is the smallest indivisible unit of work the orchestrator manages.
 * Source of truth: `2_Task_Work_Orchestrator_v0.2.md` (§2, §3). The canonical
 * Task state machine is not duplicated here — the union below mirrors §3
 * exactly, including the `RETRYING` state shown in the state diagram.
 */

import type { ArtifactID, ContextID, DecisionID, EvidenceID, TaskID, WorkflowID } from './ids.js';
import type { AgentType } from './agent-run.js';

/**
 * The canonical Task status values (orchestrator spec §3).
 */
export const TaskStatus = {
  Pending: 'PENDING',
  Queued: 'QUEUED',
  Executing: 'EXECUTING',
  Verifying: 'VERIFYING',
  AwaitingReview: 'AWAITING_REVIEW',
  Approved: 'APPROVED',
  Rejected: 'REJECTED',
  Rework: 'REWORK',
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  AwaitingHumanIntervention: 'AWAITING_HUMAN_INTERVENTION',
  Cancelled: 'CANCELLED',
  Retrying: 'RETRYING',
} as const;
/** A Task status. */
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/**
 * Task priority (orchestrator spec §2.2).
 */
export const Priority = {
  Critical: 'CRITICAL',
  High: 'HIGH',
  Medium: 'MEDIUM',
  Low: 'LOW',
} as const;
/** Task priority. */
export type Priority = (typeof Priority)[keyof typeof Priority];

/** Who owns / initiated a task (orchestrator spec §2.2). */
export type Owner = 'human' | 'system';

/** A JSON Schema document, intentionally left loose at the domain edge. */
export type JsonSchema = Record<string, unknown>;

/** The runtime behavior of a workflow (orchestrator spec §2.3). */
export const FailureStrategy = {
  FailFast: 'FAIL_FAST',
  Continue: 'CONTINUE',
  Rollback: 'ROLLBACK',
} as const;
/** A workflow failure strategy. */
export type FailureStrategy = (typeof FailureStrategy)[keyof typeof FailureStrategy];

/**
 * A single unit of work (orchestrator spec §2.2).
 */
export interface Task {
  /** Unique task id. */
  readonly id: TaskID;
  /** The workflow this task belongs to. */
  readonly workflowId: WorkflowID;
  /** Short task name. */
  readonly name: string;
  /** Human-readable description. */
  readonly description: string;
  /** The developer's requirements. */
  readonly requirements: string;
  /** Reference to the Context Engine snapshot used. */
  readonly contextRef?: ContextID;
  /** Current lifecycle status. */
  readonly status: TaskStatus;
  /** Who created the task. */
  readonly owner: Owner;
  /** Agent profiles permitted to execute this task. */
  readonly agents: AgentType[];
  /** Artifacts produced by this task. */
  readonly artifacts: ArtifactID[];
  /** Evidence (test results, compiler output, analysis) attached. */
  readonly evidence: EvidenceID[];
  /** Human decisions recorded against this task. */
  readonly decisions: DecisionID[];
  /** Final outcome text. */
  readonly outcome?: string;
  /** Expected input JSON Schema. */
  readonly inputSchema?: JsonSchema;
  /** Expected output JSON Schema. */
  readonly outputSchema?: JsonSchema;
  /** Task priority. */
  readonly priority: Priority;
  /** Blocking dependencies. */
  readonly dependsOn: TaskID[];
  /** Number of attempts already made. */
  readonly retryCount: number;
  /** Maximum allowed attempts. */
  readonly maxRetries: number;
  /** Hard timeout in seconds. */
  readonly timeoutSeconds: number;
  /** Creation time. */
  readonly createdAt: Date;
  /** Time execution started. */
  readonly startedAt?: Date;
  /** Time execution finished. */
  readonly completedAt?: Date;
  /** Link to the primary stored evidence/output. */
  readonly resultRef?: EvidenceID;
  /** Free-form extension metadata. */
  readonly metadata: Record<string, unknown>;
}

/** Input for {@link createTask}. */
export type CreateTaskInput = {
  readonly id: TaskID;
  readonly workflowId: WorkflowID;
  readonly name: string;
  readonly description: string;
  readonly requirements: string;
  readonly status?: TaskStatus;
  readonly owner?: Owner;
  readonly agents?: AgentType[];
  readonly artifacts?: ArtifactID[];
  readonly evidence?: EvidenceID[];
  readonly decisions?: DecisionID[];
  readonly priority?: Priority;
  readonly dependsOn?: TaskID[];
  readonly retryCount?: number;
  readonly maxRetries?: number;
  readonly timeoutSeconds?: number;
  readonly createdAt?: Date;
  readonly contextRef?: ContextID;
  readonly outcome?: string;
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly resultRef?: EvidenceID;
  readonly metadata?: Record<string, unknown>;
};

/**
 * Build a {@link Task} with sensible defaults for a newly created task.
 */
export function createTask(input: CreateTaskInput): Task {
  return {
    status: TaskStatus.Pending,
    owner: 'system',
    agents: [],
    artifacts: [],
    evidence: [],
    decisions: [],
    priority: Priority.Medium,
    dependsOn: [],
    retryCount: 0,
    maxRetries: 3,
    timeoutSeconds: 3600,
    createdAt: new Date(),
    metadata: {},
    ...input,
  };
}
