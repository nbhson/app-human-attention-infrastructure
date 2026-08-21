/**
 * Declarative workflow model (day-09 §2.1).
 *
 * Workflows are data, not code: an ordered list of steps that the
 * {@link import('./workflow-runner.js').WorkflowRunner} walks. Phase 1 ships a
 * single linear workflow — no branching, no parallelism. When Phase 2 adds
 * conditionals, they arrive as a field on `WorkflowStep`, not as `if` chains.
 */

export const StepKind = {
  COLLECT_CONTEXT: 'COLLECT_CONTEXT',
  EXECUTE: 'EXECUTE',
  VERIFY: 'VERIFY',
} as const;

export type StepKind = (typeof StepKind)[keyof typeof StepKind];

export interface WorkflowStep {
  readonly kind: StepKind;
  /** Human-readable label for logs and UI. */
  readonly label: string;
  /** Step-level timeout in ms. 0 = no timeout. */
  readonly timeoutMs: number;
}

export interface WorkflowDefinition {
  readonly id: string;
  /** Bump on any step change. */
  readonly version: number;
  /** Executed in array order — no branching in Phase 1. */
  readonly steps: readonly WorkflowStep[];
}

/** The single Phase 1 workflow (day-09 §2.1). */
export const LINEAR_WORKFLOW_V1: WorkflowDefinition = {
  id: 'linear-v1',
  version: 1,
  steps: [
    { kind: StepKind.COLLECT_CONTEXT, label: 'Collect Context', timeoutMs: 30_000 },
    { kind: StepKind.EXECUTE, label: 'Execute with Agent', timeoutMs: 300_000 },
    { kind: StepKind.VERIFY, label: 'Verify Artifacts', timeoutMs: 120_000 },
  ],
};
