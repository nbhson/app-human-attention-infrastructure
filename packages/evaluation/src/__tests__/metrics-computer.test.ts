/**
 * Known-answer tests for `MetricsComputer` (day-06 §3.3–3.4).
 *
 * The precision/recall/leakage numbers below are *hand-computed* from the fixture
 * first, then asserted exactly — no `toEqual(anything)`. The point is that the
 * ground-truth labels come from decision + rework outcomes, never the engine's
 * own scores: witness that a route row carries no field sourced from the
 * Attention Engine's scoring path.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { gauges, register, setGauge } from '@harness/observability';

import { applyGauges, MetricsComputer } from '../metrics-computer.js';
import type { DecisionRow, MetricsInput, ReworkRow, RouteRow } from '../report.js';

const T0 = new Date('2026-08-01T00:00:00Z');

function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

/** Mutable fixture (its arrays are spread/edited per test). */
interface Fixture {
  readonly from: Date;
  readonly to: Date;
  decisionLog: DecisionRow[];
  reworkLog: ReworkRow[];
  routeLog: RouteRow[];
}

/** Four routes: two human (one warranted, one not), two auto (one defects later). */
function fixture(): Fixture {
  return {
    from: T0,
    to: at(60),
    decisionLog: [
      {
        decisionId: 'd-rej',
        assessmentId: 'a1',
        changeId: 'c1',
        decision: 'REJECTED',
        createdAt: at(10),
      },
      {
        decisionId: 'd-app',
        assessmentId: 'a2',
        changeId: 'c2',
        decision: 'APPROVED',
        createdAt: at(20),
        dwellSeconds: 3600, // 60 min
      },
    ],
    reworkLog: [{ taskId: 't4', toState: 'REWORK', occurredAt: at(50) }],
    routeLog: [
      {
        queueId: 'q1',
        assessmentId: 'a1',
        taskId: 't1',
        action: 'REVIEW_REQUIRED',
        occurredAt: at(1),
        label: 'HIGH',
      },
      {
        queueId: 'q2',
        assessmentId: 'a2',
        taskId: 't2',
        action: 'REVIEW_RECOMMENDED',
        occurredAt: at(2),
        label: 'MEDIUM',
      },
      {
        queueId: 'q3',
        assessmentId: 'a3',
        taskId: 't3',
        action: 'AUTO_APPROVABLE',
        occurredAt: at(3),
        label: 'LOW',
      },
      {
        queueId: 'q4',
        assessmentId: 'a4',
        taskId: 't4',
        action: 'AUTO_APPROVABLE',
        occurredAt: at(4),
        label: 'CRITICAL',
      },
    ],
  };
}

describe('MetricsComputer (spec 11 §4.1/§4.2)', () => {
  const computer = new MetricsComputer();

  it('computes the hand-derived routing + efficiency numbers exactly', () => {
    const report = computer.compute(fixture());

    // warranted human = a1 (REJECTED). human = {a1, a2} → precision 1/2.
    expect(report.routing.precision).toBe(0.5);
    // warranted = a1 (routed). missed = t4 (auto → later rework). recall 1/(1+1).
    expect(report.routing.recall).toBe(0.5);
    // flythrough = {a3, a4}; defected = {a4} → leakage 1/2.
    expect(report.routing.escalationLeakage).toBe(0.5);
    // one accepted decision at 3600s → 60 min.
    expect(report.efficiency.humanMinutesPerAccept).toBe(60);
    // labels CRITICAL + HIGH = 2 of 4 → 0.5.
    expect(report.efficiency.inflationRatio).toBe(0.5);
  });

  it('matches a non-integer precision to 4 decimal places', () => {
    const base = fixture();
    base.routeLog.push({
      queueId: 'q5',
      assessmentId: 'a5',
      taskId: 't5',
      action: 'ESCALATE',
      occurredAt: at(5),
      label: 'HIGH',
    });
    base.decisionLog.push({
      decisionId: 'd-rej2',
      assessmentId: 'a5',
      changeId: 'c5',
      decision: 'REJECTED',
      createdAt: at(11),
    });
    const precision = computer.compute(base).routing.precision;
    expect(precision).toBeCloseTo(2 / 3, 4);
  });

  it('is deterministic — two runs emit byte-identical reports', () => {
    const input: MetricsInput = fixture();
    const a = JSON.stringify(computer.compute(input));
    const b = JSON.stringify(computer.compute(input));
    expect(a).toBe(b);
  });

  it('returns an empty report (no NaN/Infinity) on an empty window', () => {
    const report = computer.compute({
      from: T0,
      to: at(60),
      decisionLog: [],
      reworkLog: [],
      routeLog: [],
    });
    expect(report.routing.precision).toBeUndefined();
    expect(report.routing.recall).toBeUndefined();
    expect(report.routing.escalationLeakage).toBeUndefined();
    expect(report.efficiency.humanMinutesPerAccept).toBeUndefined();
    expect(report.efficiency.inflationRatio).toBeUndefined();
  });

  it('omits human-minutes when any accepted decision lacks dwell', () => {
    const base = fixture();
    base.decisionLog[1] = {
      decisionId: 'd-app',
      assessmentId: 'a2',
      changeId: 'c2',
      decision: 'APPROVED',
      createdAt: at(20),
    };
    expect(computer.compute(base).efficiency.humanMinutesPerAccept).toBeUndefined();
  });

  it('omits recall when nothing was warranted and nothing defected', () => {
    const base = fixture();
    base.decisionLog = [
      {
        decisionId: 'd-app',
        assessmentId: 'a1',
        changeId: 'c1',
        decision: 'APPROVED',
        createdAt: at(10),
        dwellSeconds: 60,
      },
      {
        decisionId: 'd-app2',
        assessmentId: 'a2',
        changeId: 'c2',
        decision: 'APPROVED',
        createdAt: at(20),
        dwellSeconds: 60,
      },
    ];
    base.reworkLog = [];
    const report = computer.compute(base);
    expect(report.routing.recall).toBeUndefined(); // 0 / 0
    expect(report.routing.precision).toBe(0); // 0 warranted / 2 human
  });
});

describe('applyGauges (day-06 §3.4)', () => {
  const names = [
    'harness_routing_precision',
    'harness_routing_recall',
    'harness_routing_escalation_leakage',
    'harness_attention_human_minutes_per_accept',
    'harness_attention_inflation_ratio',
  ] as const;

  beforeEach(() => {
    for (const name of names) {
      gauges.get(name)?.reset();
    }
  });

  it('pushes the computed routing gauge onto the Day-04 registry', async () => {
    applyGauges(new MetricsComputer().compute(fixture()));
    const text = await register.metrics();
    expect(text).toContain('harness_routing_precision 0.5');
    expect(text).toContain('harness_attention_human_minutes_per_accept 60');
  });

  it('does not touch a gauge whose metric is undefined', async () => {
    // Seed a known value, then run an empty window (every metric omits its
    // gauge). applyGauges must leave the seeded value alone — an honest hole is
    // an *absence*, not a clobber-to-zero.
    setGauge('harness_routing_precision', 0.5);
    applyGauges(
      new MetricsComputer().compute({
        from: T0,
        to: at(60),
        decisionLog: [],
        reworkLog: [],
        routeLog: [],
      }),
    );
    const text = await register.metrics();
    expect(text).toContain('harness_routing_precision 0.5');
  });
});
