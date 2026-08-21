/**
 * `WorkflowRunner` — walks a {@link WorkflowDefinition} step-by-step (day-09 §2.5).
 *
 * It orchestrates; it never does the work. Each step hands off to a
 * `StepHandler` from the registry, and the outcome is written to `task_step_log`
 * (a `STARTED` row before the call, `COMPLETED`/`FAILED` after — §2.3). A failed
 * or timed-out step escalates the task to `AWAITING_HUMAN_INTERVENTION`
 * immediately; there is no retry here (that is Day 10's job — §6).
 *
 * The runner is *not* triggered by polling: the Agent Runtime's completion
 * handler calls it (Day 12). Today it is built and tested in isolation against
 * stub handlers.
 */

import { eq } from 'drizzle-orm';

import { TaskStatus, uuidv7 } from '@harness/domain';
import type { TaskID } from '@harness/domain';
import { taskStepLog } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import { TaskService } from '../task-service.js';
import type { StepContext, StepHandler, StepResult } from './step-handler.js';
import type { StepKind, WorkflowDefinition } from './workflow-definition.js';

/** A step that failed or timed out. */
type FailedStepResult = Extract<StepResult, { ok: false }>;

/** The step-status literals written to `task_step_log.status` (day-09 §2.3). */
const STEP_STATUS = {
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

/**
 * Race `promise` against a `ms` timeout. `ms === 0` disables the timeout.
 * Resolves with the promise's value, or rejects `Error('STEP_TIMEOUT')`. The
 * timer is cleared on either settlement so a fast step never leaves a stray
 * timeout keeping the process alive.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms === 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('STEP_TIMEOUT')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class WorkflowRunner {
  constructor(
    private readonly db: DrizzleDB,
    private readonly taskService: TaskService,
    private readonly handlers: ReadonlyMap<StepKind, StepHandler>,
  ) {}

  /**
   * Execute `workflow` for `taskId`, in step order. On success the task is left
   * untouched (it stays `EXECUTING`; the completion handler owns the next
   * transition). On the first failure the task moves to
   * `AWAITING_HUMAN_INTERVENTION` and no further steps run.
   */
  async run(taskId: TaskID, workflow: WorkflowDefinition): Promise<void> {
    for (const [stepIndex, step] of workflow.steps.entries()) {
      const ctx: StepContext = { taskId, workflowId: workflow.id, stepIndex };
      const logId = uuidv7();

      // §2.3: STARTED is written *before* the handler runs so a mid-step crash
      // leaves the in-flight step visible. `started_at` is `defaultNow()`.
      await this.db.insert(taskStepLog).values({
        id: logId,
        task_id: taskId,
        workflow_id: workflow.id,
        workflow_ver: workflow.version,
        step_index: stepIndex,
        step_kind: step.kind,
        status: STEP_STATUS.STARTED,
        output: null,
      });

      const handler = this.handlers.get(step.kind);
      if (!handler) {
        // A missing handler is a configuration bug; fail loudly rather than skip.
        await this.failStep(logId, taskId, {
          ok: false,
          error: `NO_HANDLER_FOR_${step.kind}`,
          retriable: false,
        });
        return;
      }

      let result: StepResult;
      try {
        result = await withTimeout(handler(ctx), step.timeoutMs);
      } catch (error) {
        // A thrown exception (or timeout) is a failed step too (day-09 §3.6).
        const message = error instanceof Error ? error.message : String(error);
        result =
          message === 'STEP_TIMEOUT'
            ? { ok: false, error: 'STEP_TIMEOUT', retriable: true }
            : { ok: false, error: message, retriable: false };
      }

      if (result.ok) {
        await this.db
          .update(taskStepLog)
          .set({ status: STEP_STATUS.COMPLETED, output: result.output, finished_at: new Date() })
          .where(eq(taskStepLog.id, logId));
        continue;
      }

      await this.failStep(logId, taskId, result);
      return;
    }

    // Every step succeeded — deliberately no transition (day-09 §2.5).
  }

  /** Record the step as FAILED, then escalate the whole task. */
  private async failStep(logId: string, taskId: TaskID, result: FailedStepResult): Promise<void> {
    await this.db
      .update(taskStepLog)
      .set({
        status: STEP_STATUS.FAILED,
        output: { error: result.error, retriable: result.retriable },
        finished_at: new Date(),
      })
      .where(eq(taskStepLog.id, logId));
    await this.taskService.transitionTask(
      taskId,
      TaskStatus.AwaitingHumanIntervention,
      'orchestrator',
    );
  }
}
