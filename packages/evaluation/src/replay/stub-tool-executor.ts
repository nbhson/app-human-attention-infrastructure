/**
 * No-op tool executor (day-08 §2.1, §3.1).
 *
 * Replay must never touch a live tool or the network — the recorded `tool_output`
 * *is* the observation. {@link StubToolExecutor} resolves `execute(toolName,
 * toolInput)` by looking the pair up in the recorded {@link TrajectoryStep} list
 * and returning the step's own `tool_output`. This proves the input→output
 * pairing is intact, not that a fake tool "would have" produced something: if no
 * recorded step has that exact input, the pairing is broken and the executor
 * raises {@link ReplayDivergenceError} rather than inventing a result.
 */

import type { TrajectoryStep } from '@harness/domain';

import { ReplayDivergenceError } from './errors.js';
import { stableStringify } from './hash.js';

/** The minimal tool surface replay needs (injected seam for the zero-live-call test). */
export interface ToolExecutor {
  execute(toolName: string, toolInput: Record<string, unknown>): string;
}

function toolKey(toolName: string, toolInput: Record<string, unknown>): string {
  return `${toolName}::${stableStringify(toolInput)}`;
}

export class StubToolExecutor implements ToolExecutor {
  private readonly outputByKey = new Map<string, string>();

  /** Number of tool calls the stub has resolved from recorded output. */
  private resolved = 0;

  constructor(steps: readonly TrajectoryStep[]) {
    for (const step of steps) {
      if (step.type === 'TOOL_CALL' && step.toolOutput !== undefined) {
        this.outputByKey.set(toolKey(step.toolName, step.toolInput), step.toolOutput);
      }
    }
  }

  /** How many tool calls have been resolved so far (purely from recorded data). */
  get resolvedToolCalls(): number {
    return this.resolved;
  }

  execute(toolName: string, toolInput: Record<string, unknown>): string {
    const output = this.outputByKey.get(toolKey(toolName, toolInput));
    if (output === undefined) {
      throw new ReplayDivergenceError(
        `no recorded tool_output for "${toolName}" with this tool_input — the input→output pairing is broken`,
      );
    }
    this.resolved += 1;
    return output;
  }
}
