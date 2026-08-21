/**
 * Step execution contract (day-09 §2.2).
 *
 * A step handler is registered per {@link import('./workflow-definition.js').StepKind}
 * at bootstrap time. It does the *actual work* for one step, so the
 * {@link import('./workflow-runner.js').WorkflowRunner} stays orchestration-only
 * — it sequences steps and interprets outcomes, never performs the work itself.
 */

import type { TaskID } from '@harness/domain';

export interface StepContext {
  readonly taskId: TaskID;
  readonly workflowId: string;
  readonly stepIndex: number;
}

export type StepResult =
  | { readonly ok: true; readonly output: Record<string, unknown> }
  | { readonly ok: false; readonly error: string; readonly retriable: boolean };

export type StepHandler = (ctx: StepContext) => Promise<StepResult>;
