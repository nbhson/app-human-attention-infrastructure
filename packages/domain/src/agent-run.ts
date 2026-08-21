/**
 * AI Agent execution types.
 *
 * Models the Agent Runtime's executive objects: the agent kinds the runtime can
 * instantiate, the lifecycle states of a run, the immutable (replayable)
 * trajectory of steps, and the execution request the orchestrator hands over.
 * Source: `3_AI_Agent_Runtime_v0.2.md` (§2, §3, §4, §6, §11).
 */

import type { AgentRunID, ProjectID, TaskID } from './ids.js';

/**
 * The kinds of agent the runtime can instantiate (agent-runtime spec §4).
 * Phase 1 only exercises `CODING_AGENT`; the rest are defined now so profiles
 * are stable.
 */
export const AgentType = {
  CodingAgent: 'CODING_AGENT',
  TestingAgent: 'TESTING_AGENT',
  ReviewAgent: 'REVIEW_AGENT',
  DocumentationAgent: 'DOCUMENTATION_AGENT',
  ArchitectureAgent: 'ARCHITECTURE_AGENT',
} as const;
/** A known agent profile. */
export type AgentType = (typeof AgentType)[keyof typeof AgentType];

/**
 * The lifecycle state of an in-flight agent run (agent-runtime spec §3).
 */
export const AgentRunStatus = {
  Initialized: 'INITIALIZED',
  Planning: 'PLANNING',
  Executing: 'EXECUTING',
  ToolCalling: 'TOOL_CALLING',
  Observing: 'OBSERVING',
  Finalizing: 'FINALIZING',
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  Escalated: 'ESCALATED',
  Cancelled: 'CANCELLED',
  Error: 'ERROR',
} as const;
/** A state in the agent-run lifecycle. */
export type AgentRunStatus = (typeof AgentRunStatus)[keyof typeof AgentRunStatus];

/** The final terminal status reported back to the orchestrator (spec §11). */
export const AgentExecutionStatus = {
  Success: 'SUCCESS',
  Failed: 'FAILED',
  Cancelled: 'CANCELLED',
  Partial: 'PARTIAL',
} as const;
/** A terminal outcome of an agent execution. */
export type AgentExecutionStatus = (typeof AgentExecutionStatus)[keyof typeof AgentExecutionStatus];

/** An LLM provider supported by the runtime (agent-runtime spec §11). */
export const ModelProvider = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  Gemini: 'gemini',
} as const;
/** A supported LLM provider. */
export type ModelProvider = (typeof ModelProvider)[keyof typeof ModelProvider];

/**
 * The model configuration for a single execution (agent-runtime spec §11).
 */
export interface ModelConfig {
  /** The provider to call. */
  readonly provider: ModelProvider;
  /** The concrete model id, e.g. `"claude-sonnet-5"`. */
  readonly model: string;
  /** Sampling temperature in `[0, 2]`. */
  readonly temperature: number;
  /** Maximum output tokens for the call. */
  readonly maxTokens: number;
}

/**
 * One entry in an agent's trajectory (agent-runtime spec §6).
 *
 * Trajectory steps form an immutable, append-ordered event stream. Variants:
 * `THOUGHT` (the agent's stated reasoning), `TOOL_CALL` (a tool invocation with
 * its input and output), and `OBSERVATION` (a received intermediate result).
 */
export type TrajectoryStep =
  | {
      readonly type: 'THOUGHT';
      readonly stepIndex: number;
      readonly timestamp: Date;
      readonly content: string;
      readonly modelUsed?: string;
      readonly promptHash?: string;
    }
  | {
      readonly type: 'TOOL_CALL';
      readonly stepIndex: number;
      readonly timestamp: Date;
      readonly toolName: string;
      readonly toolInput: Record<string, unknown>;
      readonly toolOutput?: string;
    }
  | {
      readonly type: 'OBSERVATION';
      readonly stepIndex: number;
      readonly timestamp: Date;
      readonly content: string;
    };

/**
 * The recorded execution of a task by an agent (agent-runtime spec §6).
 *
 * The trajectory is an event-sourced entity: its `steps` are append-only, and
 * "current state" is a replay of the stream. It never stores a mutated blob.
 */
export interface AgentRun {
  /** Unique run id. */
  readonly id: AgentRunID;
  /** The task this run is executing. */
  readonly taskId: TaskID;
  /** The agent profile used. */
  readonly agentType: AgentType;
  /** The model used for generation. */
  readonly modelUsed: string;
  /** The current lifecycle state. */
  readonly status: AgentRunStatus;
  /** ISO-8601 start time. */
  readonly startTimestamp: Date;
  /** ISO-8601 end time (set once the run finishes). */
  readonly endTimestamp?: Date;
  /** Cumulative tokens consumed across the run. */
  readonly totalTokensUsed: number;
  /** The append-only trajectory. */
  readonly steps: TrajectoryStep[];
  /** The agent's final output message. */
  readonly finalOutput?: string;
  /** Relative paths of files created or modified during the run. */
  readonly artifactsChanged: string[];
  /** If this run was forked from another, the parent run + step index. */
  readonly forkedFrom?: { readonly runId: AgentRunID; readonly stepIndex: number };
}

/**
 * The orchestrator's request to execute an agent (agent-runtime spec §11).
 */
export interface AgentExecutionRequest {
  /** The task to execute. */
  readonly taskId: TaskID;
  /** Which profile to instantiate. */
  readonly agentType: AgentType;
  /** Context pre-processed by the Context Engine. */
  readonly context: string;
  /** Model + sampling configuration. */
  readonly modelConfig: ModelConfig;
  /** The list of permitted tool names. */
  readonly allowedTools: string[];
  /** Specific task instructions for the agent. */
  readonly instructions: string;
  /** Max Think→Act→Observe loops before auto-fail. Defaults to 10. */
  readonly maxSteps: number;
  /** The project this request belongs to (for provenance). */
  readonly projectId?: ProjectID;
}

/** The default max-step limit when none is supplied (agent-runtime spec §14). */
export const DEFAULT_MAX_STEPS = 10;

/** Input for {@link createAgentExecutionRequest}. */
export type CreateAgentExecutionRequestInput = Omit<AgentExecutionRequest, 'maxSteps'> &
  Partial<Pick<AgentExecutionRequest, 'maxSteps' | 'projectId'>>;

/**
 * Build an {@link AgentExecutionRequest}, defaulting `maxSteps` to 10.
 */
export function createAgentExecutionRequest(
  input: CreateAgentExecutionRequestInput,
): AgentExecutionRequest {
  return { maxSteps: DEFAULT_MAX_STEPS, ...input };
}
