/**
 * `TrajectoryRecorder` (day-13 §2.4 / §3.5) — persists every {@link ReActStep} to
 * the `trajectory_steps` table in real time.
 *
 * The ReAct loop calls `record` after each step, streaming the full audit trail
 * (reasoning + tool call + observation) as it happens rather than buffering it.
 * The recorder is a thin wrapper over {@link DrizzleDB}: no buffering, no
 * dedup, one insert per step — the table is the append-only source of truth for
 * "what did the agent actually think and do".
 */

import { uuidv7 } from '@harness/domain';
import type { AgentRunID } from '@harness/domain';
import { trajectorySteps } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import type { ReActStep } from '../react/react-loop.js';

/** Tool name stamped on a warning row (Spec 4 §8 "use STALE with a warning"). */
export const WARNING_TOOL = 'harness.warning';

/** The `step_number` reserved for non-step warning rows (real steps start at 1). */
export const WARNING_STEP_NUMBER = 0;

export class TrajectoryRecorder {
  constructor(private readonly db: DrizzleDB) {}

  /** Persist one step. Nullable fields are stored as `null`, never `undefined`. */
  async record(agentRunId: AgentRunID, step: ReActStep): Promise<void> {
    await this.db.insert(trajectorySteps).values({
      id: uuidv7(),
      agent_run_id: agentRunId,
      step_number: step.stepNumber,
      thought: step.thought ?? null,
      tool_name: step.toolCall?.name ?? null,
      tool_input: step.toolCall?.input ?? null,
      observation: step.observation ?? null,
    });
  }

  /**
   * Append a non-execution warning (e.g. `STALE_CONTEXT`) to the run's audit
   * trail. The warning becomes an `observation` row with a reserved
   * `harness.warning` tool name and `step_number` 0, so it never collides with a
   * real ReAct step. Spec 4 §8 lets a consumer keep using a STALE snapshot *as
   * long as* the trajectory records the warning — this is that seam.
   */
  async recordWarning(agentRunId: AgentRunID, message: string): Promise<void> {
    await this.db.insert(trajectorySteps).values({
      id: uuidv7(),
      agent_run_id: agentRunId,
      step_number: WARNING_STEP_NUMBER,
      thought: null,
      tool_name: WARNING_TOOL,
      tool_input: null,
      observation: message,
    });
  }
}
