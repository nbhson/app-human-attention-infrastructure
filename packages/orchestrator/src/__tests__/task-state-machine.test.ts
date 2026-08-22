import { describe, expect, it } from 'vitest';

import { TaskStatus } from '@harness/domain';

import { TaskStateMachine } from '../state-machine/task-state-machine.js';

/**
 * The authoritative transition spec for Day 06 (day-06.md §2.2). The machine's
 * table must match this list exactly; the exhaustive test below catches any drift
 * between the two.
 */
const LEGAL: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
  [TaskStatus.Pending, TaskStatus.Queued],
  [TaskStatus.Pending, TaskStatus.Cancelled],
  [TaskStatus.Queued, TaskStatus.Executing],
  [TaskStatus.Queued, TaskStatus.Cancelled],
  [TaskStatus.Executing, TaskStatus.Verifying],
  [TaskStatus.Executing, TaskStatus.Failed],
  [TaskStatus.Executing, TaskStatus.AwaitingHumanIntervention],
  [TaskStatus.Verifying, TaskStatus.AwaitingReview],
  [TaskStatus.Verifying, TaskStatus.Rework],
  [TaskStatus.Verifying, TaskStatus.Failed],
  // Day-28 recovery path: the startup reconciler moves a VERIFYING task stranded
  // by a crash to human attention, mirroring EXECUTING → AWH.
  [TaskStatus.Verifying, TaskStatus.AwaitingHumanIntervention],
  [TaskStatus.AwaitingReview, TaskStatus.Approved],
  [TaskStatus.AwaitingReview, TaskStatus.Rejected],
  [TaskStatus.Rework, TaskStatus.Queued],
  [TaskStatus.Rework, TaskStatus.Cancelled],
  [TaskStatus.Rework, TaskStatus.Failed],
  [TaskStatus.Rejected, TaskStatus.Rework],
  [TaskStatus.Rejected, TaskStatus.Failed],
  [TaskStatus.Rejected, TaskStatus.Cancelled],
  [TaskStatus.AwaitingHumanIntervention, TaskStatus.Queued],
  [TaskStatus.AwaitingHumanIntervention, TaskStatus.Cancelled],
  [TaskStatus.Approved, TaskStatus.Completed],
  [TaskStatus.Approved, TaskStatus.AwaitingHumanIntervention],
  [TaskStatus.Failed, TaskStatus.Queued],
  [TaskStatus.Failed, TaskStatus.Cancelled],
];

const ALL_STATES = Object.values(TaskStatus);
const LEGAL_KEYS = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));

const sm = new TaskStateMachine();

describe('TaskStateMachine', () => {
  it('exposes exactly the canonical 13 states (including the deferred RETRYING)', () => {
    expect(ALL_STATES).toHaveLength(13);
    expect(ALL_STATES).toContain(TaskStatus.Retrying);
  });

  it('accepts every legal transition in day-06 §2.2', () => {
    for (const [from, to] of LEGAL) {
      expect(sm.canTransition(from, to), `${from} -> ${to} should be legal`).toBe(true);
    }
  });

  it('rejects every pair not in day-06 §2.2 (exhaustive)', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = LEGAL_KEYS.has(`${from}->${to}`);
        expect(sm.canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('marks only COMPLETED and CANCELLED terminal', () => {
    for (const state of ALL_STATES) {
      const expected = state === TaskStatus.Completed || state === TaskStatus.Cancelled;
      expect(sm.isTerminal(state), state).toBe(expected);
    }
  });

  it('returns the exact legal targets for PENDING', () => {
    expect(sm.legalTargets(TaskStatus.Pending)).toEqual([TaskStatus.Queued, TaskStatus.Cancelled]);
  });

  it('leaves RETRYING unreachable until Day 10', () => {
    expect(sm.legalTargets(TaskStatus.Retrying)).toEqual([]);
  });

  it('requires rationale for human transitions, not for APPROVED -> COMPLETED', () => {
    expect(sm.requiresRationale(TaskStatus.Rejected, TaskStatus.Rework)).toBe(true);
    expect(sm.requiresRationale(TaskStatus.Approved, TaskStatus.Completed)).toBe(false);
    expect(sm.requiresRationale(TaskStatus.Rework, TaskStatus.Queued)).toBe(false);
  });
});
