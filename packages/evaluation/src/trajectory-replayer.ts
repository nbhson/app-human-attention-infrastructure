/**
 * Trajectory replay engine (day-08 §2.1–2.2, §3.2).
 *
 * Re-materialises a recorded run step-by-step from its stored `steps[]`, with no
 * live LLM and no live tool calls. Fidelity is *enforced*, not advisory: the hash
 * is verified before the loop (§2.3), every step's `stepIndex` must be contiguous
 * with the array position, and each TOOL_CALL is resolved through the no-op
 * {@link StubToolExecutor} against the recorded output. Any divergence throws —
 * a replay that silently drifts would poison the Day-09 A/B comparison.
 */

import type { AgentRun, AgentRunID } from '@harness/domain';

import { ReplayDivergenceError, TrajectoryHashMismatchError } from './replay/errors.js';
import { hashSteps } from './replay/hash.js';
import { StubToolExecutor, type ToolExecutor } from './replay/stub-tool-executor.js';

export interface ReplayInput {
  readonly runId: AgentRunID;
  readonly trajectory: AgentRun;
  /** The recorded content hash to verify against before replaying (§2.3). */
  readonly expectedSourceHash?: string;
}

export interface ReplayStep {
  readonly index: number;
  readonly type: 'THOUGHT' | 'TOOL_CALL' | 'OBSERVATION';
  readonly replayed: boolean;
  readonly matched: boolean;
  /** Divergence detail — only ever surfaced via a thrown error, never in a result. */
  readonly note?: string;
}

export interface ReplayResult {
  readonly runId: string;
  readonly steps: ReplayStep[];
  readonly unmatched: number;
  readonly resolvedToolCalls: number;
  readonly wouldHaveTokens: number;
  readonly sourceHash: string;
}

export class TrajectoryReplayer {
  /**
   * @param executor - the tool seam. Defaults to a {@link StubToolExecutor} built
   * from the trajectory being replayed; inject a spy for the zero-live-call test.
   */
  constructor(private readonly executor?: ToolExecutor) {}

  replay(input: ReplayInput): ReplayResult {
    const { trajectory } = input;
    const sourceHash = hashSteps(trajectory.steps);

    // Hash before the loop (§2.3): replaying a tampered stream is worse than not
    // replaying at all, so a mismatch aborts before any step is re-materialised.
    if (input.expectedSourceHash !== undefined && input.expectedSourceHash !== sourceHash) {
      throw new TrajectoryHashMismatchError(input.expectedSourceHash, sourceHash);
    }

    const executor = this.executor ?? new StubToolExecutor(trajectory.steps);
    const steps: ReplayStep[] = [];
    let resolvedToolCalls = 0;

    trajectory.steps.forEach((step, index) => {
      // Contiguity: position `index` must carry `stepIndex === index`. A gap,
      // duplicate, or re-order is a hard divergence (never a warning).
      if (step.stepIndex !== index) {
        throw new ReplayDivergenceError(
          `step at position ${index} has stepIndex ${step.stepIndex} — the recorded sequence is not contiguous`,
        );
      }

      if (step.type === 'TOOL_CALL') {
        // Re-resolve the tool call through the no-op executor; it returns the
        // *recorded* output keyed on this exact input, so a broken input→output
        // pairing surfaces here as a divergence rather than a fabricated result.
        void executor.execute(step.toolName, step.toolInput);
        resolvedToolCalls += 1;
      }

      steps.push({ index, type: step.type, replayed: true, matched: true });
    });

    return {
      runId: input.runId,
      steps,
      unmatched: 0,
      resolvedToolCalls,
      // Phase-1 records tokens at the run level (`AgentRun.totalTokensUsed`), not
      // per step, so "would-have-spent" is asserted as fidelity to that total.
      wouldHaveTokens: trajectory.totalTokensUsed,
      sourceHash,
    };
  }
}
