/**
 * `WorkflowRunner` — walks a {@link WorkflowDefinition} step-by-step (day-09 §2.5),
 * now with retry (day-10 §2.3).
 *
 * It orchestrates; it never does the work. Each step hands off to a
 * `StepHandler` from the registry, and the outcome is written to `task_step_log`
 * (a `STARTED` row before the call, `COMPLETED`/`FAILED` after — day-09 §2.3).
 *
 * On a failed step the failure is classified (day-10 §2.1) and checked against
 * the {@link RetryPolicyConfig}: inside budget, a `retry_log` row is written and
 * the step re-runs after backoff; outside budget (or `PERMANENT`), the step is
 * marked `FAILED` and the task escalates to `AWAITING_HUMAN_INTERVENTION`.
 *
 * The runner is *not* triggered by polling: the Agent Runtime's completion
 * handler calls it (Day 12). Today it is built and tested in isolation against
 * stub handlers.
 */

import { eq } from 'drizzle-orm';

import { TaskStatus, uuidv7 } from '@harness/domain';
import type { TaskID } from '@harness/domain';
import { retryLog, taskStepLog } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import { classifyError } from '../retry/classify-error.js';
import { FailureClass } from '../retry/failure-class.js';
import type { ClassifiedFailure } from '../retry/failure-class.js';
import { DEFAULT_RETRY_POLICY, computeDelay, shouldRetry } from '../retry/retry-policy.js';
import type { RetryPolicyConfig } from '../retry/retry-policy.js';
import { TaskService } from '../task-service.js';
import type { StepContext, StepHandler, StepResult } from './step-handler.js';
import type { StepKind, WorkflowDefinition, WorkflowStep } from './workflow-definition.js';

/** A step that failed or timed out (after classification, `ok` is `false`). */
type FailedStepResult = Extract<StepResult, { ok: false }>;

/** The step-status literals written to `task_step_log.status` (day-09 §2.3). */
const STEP_STATUS = {
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
    private readonly retryPolicy: RetryPolicyConfig = DEFAULT_RETRY_POLICY,
  ) {}

  /**
   * Execute `workflow` for `taskId`, in step order. On success the task is left
   * untouched (it stays `EXECUTING`; the completion handler owns the next
   * transition). On an unrecoverable step failure the task moves to
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
          failureClass: FailureClass.PERMANENT,
          retriable: false,
        });
        return;
      }

      // Per-step retry (day-10 §2.3). `attempt` is 1-based and resets each step;
      // it is *not* `tasks.attempt_number` (which counts full REWORK cycles).
      let attempt = 1;
      for (;;) {
        const result = await this.executeStep(handler, step, ctx);

        if (result.ok) {
          await this.db
            .update(taskStepLog)
            .set({ status: STEP_STATUS.COMPLETED, output: result.output, finished_at: new Date() })
            .where(eq(taskStepLog.id, logId));
          break;
        }

        const failure: ClassifiedFailure = {
          class: result.failureClass,
          message: result.error,
          raw: result.error,
        };

        if (shouldRetry(failure, attempt, this.retryPolicy)) {
          const delay = computeDelay(attempt, this.retryPolicy);
          await this.insertRetryLog(ctx, attempt, failure, delay);
          await sleep(delay);
          attempt += 1;
          continue;
        }

        await this.failStep(logId, taskId, result);
        return;
      }
    }

    // Every step succeeded — deliberately no transition (day-09 §2.5).
  }

  /** Invoke a handler under its timeout, converting throws/timeouts to a result. */
  private async executeStep(
    handler: StepHandler,
    step: WorkflowStep,
    ctx: StepContext,
  ): Promise<StepResult> {
    try {
      return await withTimeout(handler(ctx), step.timeoutMs);
    } catch (error) {
      // A thrown exception (or timeout) is a failed step too (day-09 §3.6).
      const failure = classifyError(error);
      return {
        ok: false,
        error: failure.message,
        failureClass: failure.class,
        retriable: failure.class !== FailureClass.PERMANENT,
      };
    }
  }

  /** Record one retry (day-10 §2.4): the failed attempt plus the backoff used. */
  private async insertRetryLog(
    ctx: StepContext,
    attempt: number,
    failure: ClassifiedFailure,
    delayMs: number,
  ): Promise<void> {
    await this.db.insert(retryLog).values({
      id: uuidv7(),
      task_id: ctx.taskId,
      step_index: ctx.stepIndex,
      attempt_number: attempt,
      failure_class: failure.class,
      error_message: failure.message,
      delay_ms: delayMs,
    });
  }

  /** Record the step as FAILED, then escalate the whole task. */
  private async failStep(logId: string, taskId: TaskID, result: FailedStepResult): Promise<void> {
    await this.db
      .update(taskStepLog)
      .set({
        status: STEP_STATUS.FAILED,
        output: {
          error: result.error,
          failureClass: result.failureClass,
          retriable: result.retriable,
        },
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
