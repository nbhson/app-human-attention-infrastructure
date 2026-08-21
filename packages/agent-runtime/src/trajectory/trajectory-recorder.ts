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
}
