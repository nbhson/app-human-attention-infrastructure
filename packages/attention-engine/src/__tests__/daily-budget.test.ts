/**
 * Daily-budget gate tests (day-13 §2.4, §3.5). Pure — the day-boundary and
 * deferral rule are deterministic functions of (action, decisions, budget, now),
 * so the "CRITICAL/HIGH always pass; MEDIUM/LOW defer past the budget" matrix is
 * pinned with no DB.
 */

import { describe, expect, it } from 'vitest';

import { decideDeferral, nextUtcMidnight, startOfUtcDay } from '../thresholds/daily-budget.js';

describe('startOfUtcDay / nextUtcMidnight', () => {
  it('floors to UTC midnight and steps to the next day boundary', () => {
    expect(startOfUtcDay(new Date('2026-08-20T23:59:59.999Z')).toISOString()).toBe(
      '2026-08-20T00:00:00.000Z',
    );
    expect(nextUtcMidnight(new Date('2026-08-20T05:00:00.000Z')).toISOString()).toBe(
      '2026-08-21T00:00:00.000Z',
    );
  });
});

describe('decideDeferral', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');

  it('never defers ESCALATE or REVIEW_REQUIRED (CRITICAL/HIGH always route)', () => {
    expect(decideDeferral('ESCALATE', 100, 3, now)).toEqual({
      deferred: false,
      deferredUntil: null,
    });
    expect(decideDeferral('REVIEW_REQUIRED', 100, 3, now)).toEqual({
      deferred: false,
      deferredUntil: null,
    });
  });

  it('defers REVIEW_RECOMMENDED/AUTO_APPROVABLE only once the budget is spent', () => {
    const under = decideDeferral('REVIEW_RECOMMENDED', 2, 3, now);
    expect(under.deferred).toBe(false);

    const atBudget = decideDeferral('AUTO_APPROVABLE', 3, 3, now);
    expect(atBudget.deferred).toBe(true);
    expect(atBudget.deferredUntil?.toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });

  it('leaves a deferral marker at the next UTC boundary, never the current instant', () => {
    const decision = decideDeferral('AUTO_APPROVABLE', 5, 1, now);
    expect(decision.deferredUntil).not.toBeNull();
    expect(decision.deferredUntil!.getTime()).toBeGreaterThan(now.getTime());
  });
});
