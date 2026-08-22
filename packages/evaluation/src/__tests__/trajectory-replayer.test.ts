/**
 * Tests for `TrajectoryReplayer` + `StubToolExecutor` + `loadTrajectory` (day-08).
 *
 * Fidelity is *enforced*, so most of these assert the shape of the result and the
 * exact error type a divergent stream raises. The zero-live-call test injects a
 * spy executor to prove replay touches the tool seam — and nothing else.
 */

import { fileURLToPath } from 'node:url';

import { brand, type AgentRun, type TrajectoryStep } from '@harness/domain';
import { describe, expect, it } from 'vitest';

import { ReplayDivergenceError, TrajectoryHashMismatchError } from '../replay/errors.js';
import { hashSteps } from '../replay/hash.js';
import { loadTrajectory } from '../replay/loader.js';
import { StubToolExecutor, type ToolExecutor } from '../replay/stub-tool-executor.js';
import { TrajectoryReplayer } from '../trajectory-replayer.js';

const RUN_ID = brand('run-coding-add-email-validation', 'AgentRunID');

function thought(index: number, at: string, content: string): TrajectoryStep {
  return { type: 'THOUGHT', stepIndex: index, timestamp: new Date(at), content };
}

function toolCall(
  index: number,
  at: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: string,
): TrajectoryStep {
  return {
    type: 'TOOL_CALL',
    stepIndex: index,
    timestamp: new Date(at),
    toolName,
    toolInput,
    toolOutput,
  };
}

function observation(index: number, at: string, content: string): TrajectoryStep {
  return { type: 'OBSERVATION', stepIndex: index, timestamp: new Date(at), content };
}

function makeTrajectory(steps?: TrajectoryStep[]): AgentRun {
  return {
    id: RUN_ID,
    taskId: brand('task-add-email-validation', 'TaskID'),
    agentType: 'CODING_AGENT',
    modelUsed: 'claude-sonnet-4-6',
    status: 'COMPLETED',
    startTimestamp: new Date('2026-08-19T00:00:00.000Z'),
    endTimestamp: new Date('2026-08-19T00:00:14.000Z'),
    totalTokensUsed: 1840,
    steps: steps ?? [
      thought(0, '2026-08-19T00:00:00.000Z', 'plan: add email validation'),
      toolCall(1, '2026-08-19T00:00:03.000Z', 'read_file', { path: 'src/utils/validators.ts' }, ''),
      toolCall(
        2,
        '2026-08-19T00:00:07.000Z',
        'write_file',
        {
          path: 'src/utils/validators.ts',
          content: 'export function isValidEmail(v: string): boolean { return true; }',
        },
        'wrote src/utils/validators.ts (4 lines)',
      ),
      observation(3, '2026-08-19T00:00:08.000Z', 'validators.ts now exists'),
      thought(4, '2026-08-19T00:00:11.000Z', 'task complete'),
    ],
    finalOutput: 'done',
    artifactsChanged: ['src/utils/validators.ts'],
  };
}

describe('TrajectoryReplayer', () => {
  it('replays a faithful trajectory step-for-step', () => {
    const trajectory = makeTrajectory();
    const result = new TrajectoryReplayer().replay({ runId: RUN_ID, trajectory });

    expect(result.steps).toHaveLength(5);
    expect(result.steps.every((s) => s.replayed && s.matched)).toBe(true);
    expect(result.steps.map((s) => s.type)).toEqual([
      'THOUGHT',
      'TOOL_CALL',
      'TOOL_CALL',
      'OBSERVATION',
      'THOUGHT',
    ]);
    expect(result.unmatched).toBe(0);
    expect(result.resolvedToolCalls).toBe(2);
    // Phase-1 records tokens at the run level only; "would-have-spent" asserts
    // fidelity to that recorded total (see trajectory-replayer.ts).
    expect(result.wouldHaveTokens).toBe(1840);
    expect(result.sourceHash).toBe(hashSteps(trajectory.steps));
  });

  it('is deterministic — identical trajectories hash identically', () => {
    const a = new TrajectoryReplayer().replay({ runId: RUN_ID, trajectory: makeTrajectory() });
    const b = new TrajectoryReplayer().replay({ runId: RUN_ID, trajectory: makeTrajectory() });

    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.steps).toEqual(b.steps);
  });

  it('throws ReplayDivergenceError on a dropped step (non-contiguous index)', () => {
    const steps = makeTrajectory().steps.filter((s) => s.stepIndex !== 2);

    expect(() =>
      new TrajectoryReplayer().replay({ runId: RUN_ID, trajectory: makeTrajectory(steps) }),
    ).toThrow(ReplayDivergenceError);
  });

  it('throws ReplayDivergenceError on a re-ordered step', () => {
    const original = makeTrajectory().steps;
    const swapped = [original[1]!, original[0]!, original[2]!, original[3]!, original[4]!];

    expect(() =>
      new TrajectoryReplayer().replay({ runId: RUN_ID, trajectory: makeTrajectory(swapped) }),
    ).toThrow(ReplayDivergenceError);
  });

  it('throws TrajectoryHashMismatchError when content mutates under a recorded hash', () => {
    const original = makeTrajectory();
    const recordedHash = hashSteps(original.steps);
    const tampered = original.steps.map((s): TrajectoryStep =>
      s.type === 'THOUGHT' && s.stepIndex === 0 ? { ...s, content: 'mutated plan' } : s,
    );

    expect(() =>
      new TrajectoryReplayer().replay({
        runId: RUN_ID,
        trajectory: makeTrajectory(tampered),
        expectedSourceHash: recordedHash,
      }),
    ).toThrow(TrajectoryHashMismatchError);
  });

  it('touches only the tool seam — every tool call resolves through the injected executor', () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const spy: ToolExecutor = {
      execute(name, input) {
        calls.push({ name, input });
        return '';
      },
    };

    const result = new TrajectoryReplayer(spy).replay({
      runId: RUN_ID,
      trajectory: makeTrajectory(),
    });

    expect(result.resolvedToolCalls).toBe(2);
    expect(calls.map((c) => c.name)).toEqual(['read_file', 'write_file']);
    expect(calls[0]?.input).toEqual({ path: 'src/utils/validators.ts' });
  });
});

describe('StubToolExecutor', () => {
  it('resolves recorded output by input and rejects an unknown pairing', () => {
    const executor = new StubToolExecutor(makeTrajectory().steps);

    expect(executor.execute('read_file', { path: 'src/utils/validators.ts' })).toBe('');
    expect(executor.resolvedToolCalls).toBe(1);

    expect(() => executor.execute('read_file', { path: 'other.ts' })).toThrow(
      ReplayDivergenceError,
    );
  });
});

describe('loadTrajectory', () => {
  it('loads the sealed fixture and re-derives its recorded hash from the steps', async () => {
    const path = fileURLToPath(
      new URL('../../../../fixtures/trajectories/coding-run.json', import.meta.url),
    );
    const loaded = await loadTrajectory(path);

    expect(loaded.runId).toBe('run-coding-add-email-validation');
    expect(loaded.trajectory.steps).toHaveLength(5);
    expect(loaded.trajectory.steps.every((s) => s.timestamp instanceof Date)).toBe(true);
    expect(loaded.recordedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.recordedHash).toBe(hashSteps(loaded.trajectory.steps));
  });
});
