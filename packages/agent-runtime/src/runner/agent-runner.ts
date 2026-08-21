/**
 * `AgentRunner` (day-12 §2.4) — owns one agent execution for a task.
 *
 * It claims a `QUEUED` task, spins up an {@link import('./agent-runs.js')} row,
 * drives the {@link import('../react/react-loop.js')} to a terminal outcome, and
 * then hands the task back to the Orchestrator. It is the *only* place the Agent
 * Runtime transitions a task state or writes `agent_runs`, and it does both
 * through narrow structural seams (R4: the runtime never imports the
 * Orchestrator — see {@link TaskTransitionService} and {@link CompletionHandoff}).
 *
 * Terminal outcomes:
 * - `end_turn` → `agent_runs` becomes `COMPLETED`, `task.execution_finished`
 *   (`outcome: COMPLETED`) is published, and the completion handoff starts the
 *   verification workflow.
 * - `max_steps` / {@link TokenBudgetExceededError} → `agent_runs` becomes
 *   `ESCALATED` (with `escalation_reason`), the task moves to
 *   `AWAITING_HUMAN_INTERVENTION`, and `task.execution_finished`
 *   (`outcome: ESCALATED`) is published.
 * - any other error → `agent_runs` becomes `FAILED` and the error rethrows.
 */

import { eq } from 'drizzle-orm';

import {
  AgentRunStatus,
  brand,
  DEFAULT_MAX_STEPS,
  EventType,
  newAgentRunID,
  TaskStatus,
} from '@harness/domain';
import type {
  AgentRunID,
  TaskExecutionFinishedPayload,
  TaskID,
  TaskStatus as TaskState,
  TaskTrigger,
} from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import { agentRuns } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import type { LLMProvider } from '../llm/llm-provider.js';
import { TokenBudget, TokenBudgetExceededError } from '../llm/token-budget.js';
import { ReActLoop } from '../react/react-loop.js';
import type { ReActResult } from '../react/react-loop.js';
import type { ToolRegistry } from '../tools/tool-registry.js';

/** Default per-run token ceiling (day-12 §2.4 / §6). */
export const DEFAULT_TOKEN_BUDGET = 50_000;

/** System prompt handed to the loop for every run. */
const SYSTEM_PROMPT =
  'You are a focused coding agent. Complete the assigned task using only the tools provided.';

/** The task fields the runner reads to build the loop's user message. */
export interface TaskSnapshot {
  readonly title: string;
  readonly description: string | null;
  readonly attemptNumber: number;
}

/**
 * Structural subset of the Orchestrator's `TaskService` (R4-safe): the two
 * methods the runner needs. Bootstrap injects the real `TaskService`, which
 * satisfies this shape without the runtime importing the Orchestrator.
 */
export interface TaskTransitionService {
  getTask(taskId: TaskID): Promise<TaskSnapshot | null>;
  transitionTask(taskId: TaskID, toState: TaskState, triggeredBy: TaskTrigger): Promise<unknown>;
}

/**
 * The completion handoff back to the Orchestrator (R4-safe). Bootstrap injects a
 * closure that starts `WorkflowRunner` with `LINEAR_WORKFLOW_V1`; the runner
 * neither knows nor cares what workflow definition runs after it.
 */
export interface CompletionHandoff {
  runLinearWorkflow(taskId: TaskID): Promise<void>;
}

/** Build the loop's user message out of a task record. */
function buildUserMessage(task: TaskSnapshot): string {
  return task.description ? `Task: ${task.title}\n\n${task.description}` : `Task: ${task.title}`;
}

export class AgentRunner {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly llm: LLMProvider,
    private readonly tools: ToolRegistry,
    private readonly taskService: TaskTransitionService,
    private readonly handoff: CompletionHandoff,
    private readonly maxSteps: number = DEFAULT_MAX_STEPS,
    private readonly tokenLimit: number = DEFAULT_TOKEN_BUDGET,
  ) {}

  /** Execute one task: claim, run the loop, terminate, and hand off (day-12 §2.4). */
  async runTask(taskId: TaskID): Promise<void> {
    const startedAt = Date.now();

    const task = await this.taskService.getTask(taskId);
    if (!task) {
      throw new Error(`task not found: ${taskId}`);
    }

    // Claim the task (QUEUED → EXECUTING) before creating the run row.
    await this.taskService.transitionTask(taskId, TaskStatus.Executing, 'agent_runtime');

    const runId = newAgentRunID();
    await this.db.insert(agentRuns).values({
      id: runId,
      task_id: taskId,
      attempt_number: task.attemptNumber,
      status: AgentRunStatus.Executing,
      max_steps: this.maxSteps,
      steps_used: 0,
      current_step: 0,
      escalation_reason: null,
    });

    const loop = new ReActLoop(
      this.llm,
      this.tools,
      new TokenBudget(this.tokenLimit),
      this.maxSteps,
    );

    let result: ReActResult;
    try {
      result = await loop.run(SYSTEM_PROMPT, buildUserMessage(task));
    } catch (error) {
      if (error instanceof TokenBudgetExceededError) {
        await this.escalate(taskId, runId, 'TOKEN_BUDGET_EXCEEDED', startedAt);
        return;
      }
      await this.db
        .update(agentRuns)
        .set({ status: AgentRunStatus.Failed, finished_at: new Date() })
        .where(eq(agentRuns.id, runId));
      throw error;
    }

    if (result.stopReason === 'end_turn') {
      await this.complete(taskId, runId, result, startedAt);
      return;
    }

    await this.escalate(taskId, runId, 'MAX_STEPS_EXCEEDED', startedAt);
  }

  /** end_turn: mark the run complete, publish, then hand off (day-12 §2.6). */
  private async complete(
    taskId: TaskID,
    runId: AgentRunID,
    result: ReActResult,
    startedAt: number,
  ): Promise<void> {
    const stepsUsed = result.steps.length;
    await this.db
      .update(agentRuns)
      .set({
        status: AgentRunStatus.Completed,
        steps_used: stepsUsed,
        current_step: stepsUsed,
        finished_at: new Date(),
      })
      .where(eq(agentRuns.id, runId));

    this.publishFinished(taskId, runId, 'COMPLETED', Date.now() - startedAt);
    await this.handoff.runLinearWorkflow(taskId);
  }

  /** max_steps / token budget: mark the run escalated, move the task, publish. */
  private async escalate(
    taskId: TaskID,
    runId: AgentRunID,
    reason: 'MAX_STEPS_EXCEEDED' | 'TOKEN_BUDGET_EXCEEDED',
    startedAt: number,
  ): Promise<void> {
    await this.db
      .update(agentRuns)
      .set({
        status: AgentRunStatus.Escalated,
        escalation_reason: reason,
        finished_at: new Date(),
      })
      .where(eq(agentRuns.id, runId));

    await this.taskService.transitionTask(
      taskId,
      TaskStatus.AwaitingHumanIntervention,
      'agent_runtime',
    );

    this.publishFinished(taskId, runId, 'ESCALATED', Date.now() - startedAt);
  }

  /** Emit `task.execution_finished` for both terminal outcomes (day-12 §2.6). */
  private publishFinished(
    taskId: TaskID,
    runId: AgentRunID,
    outcome: 'COMPLETED' | 'ESCALATED',
    durationMs: number,
  ): void {
    const payload: TaskExecutionFinishedPayload = {
      task_id: taskId,
      agent_run_id: runId,
      outcome,
      duration_ms: durationMs,
    };
    this.bus.publish(
      createEvent(EventType.TaskExecutionFinished, brand(taskId, 'CorrelationID'), payload),
    );
  }
}
