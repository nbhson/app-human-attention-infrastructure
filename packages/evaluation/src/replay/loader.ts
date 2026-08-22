/**
 * Fixture loader for recorded trajectories (day-08 §2.4, §3.3).
 *
 * Reads a serialised {@link AgentRun} (the `fixtures/trajectories/*.json`
 * artifacts captured from the Phase-1 pipeline), converts the JSON-encoded
 * `Date` fields back to `Date`, and returns the run alongside its *recorded*
 * content hash. The loader itself does not replay; it hands the replayer the raw
 * material plus the `recordedHash`, and the replayer verifies the hash before it
 * loops (§2.3).
 */

import { readFile } from 'node:fs/promises';

import type { AgentRun, AgentRunID, TrajectoryStep } from '@harness/domain';

export interface LoadedTrajectory {
  readonly runId: AgentRunID;
  readonly trajectory: AgentRun;
  /** The hash recorded in the fixture; `undefined` when the fixture is unsealed. */
  readonly recordedHash: string | undefined;
}

type RawStep = {
  readonly type: TrajectoryStep['type'];
  readonly stepIndex: number;
  readonly timestamp: string;
  readonly content?: string;
  readonly modelUsed?: string;
  readonly promptHash?: string;
  readonly toolName?: string;
  readonly toolInput?: Record<string, unknown>;
  readonly toolOutput?: string;
};

type RawTrajectory = Omit<AgentRun, 'startTimestamp' | 'endTimestamp' | 'steps'> & {
  readonly startTimestamp: string;
  readonly endTimestamp?: string;
  readonly steps: RawStep[];
};

interface FixtureJson {
  readonly runId: string;
  readonly sourceHash?: string;
  readonly trajectory: RawTrajectory;
}

function toStep(raw: RawStep): TrajectoryStep {
  const timestamp = new Date(raw.timestamp);
  switch (raw.type) {
    case 'THOUGHT':
      return {
        type: 'THOUGHT',
        stepIndex: raw.stepIndex,
        timestamp,
        content: raw.content ?? '',
        ...(raw.modelUsed !== undefined ? { modelUsed: raw.modelUsed } : {}),
        ...(raw.promptHash !== undefined ? { promptHash: raw.promptHash } : {}),
      };
    case 'TOOL_CALL':
      return {
        type: 'TOOL_CALL',
        stepIndex: raw.stepIndex,
        timestamp,
        toolName: raw.toolName ?? '',
        toolInput: raw.toolInput ?? {},
        ...(raw.toolOutput !== undefined ? { toolOutput: raw.toolOutput } : {}),
      };
    case 'OBSERVATION':
      return {
        type: 'OBSERVATION',
        stepIndex: raw.stepIndex,
        timestamp,
        content: raw.content ?? '',
      };
  }
}

/** Load a fixture JSON path into a typed {@link AgentRun} + its recorded hash. */
export async function loadTrajectory(path: string): Promise<LoadedTrajectory> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as FixtureJson;
  const { startTimestamp, endTimestamp, steps, ...rest } = parsed.trajectory;
  const trajectory: AgentRun = {
    ...rest,
    startTimestamp: new Date(startTimestamp),
    ...(endTimestamp !== undefined ? { endTimestamp: new Date(endTimestamp) } : {}),
    steps: steps.map(toStep),
  };
  return {
    runId: parsed.runId as AgentRunID,
    trajectory,
    recordedHash: parsed.sourceHash,
  };
}
