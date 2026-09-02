/**
 * Known-answer tests for `ReportGenerator` (day-07 §3.1).
 *
 * Deltas and trends are derived from the current window value vs the prior
 * window's persisted line — never from the engine's own scores — so every
 * assertion here feeds explicit current/previous numbers and checks the
 * arithmetic + direction by hand.
 */

import { describe, expect, it } from 'vitest';

import { EmptyWindowError, ReportGenerator } from '../report-generator.js';
import type { MetricLine, MetricsReport } from '../report.js';

const generator = new ReportGenerator();

function currentReport(overrides: {
  precision: number;
  recall: number;
  escalationLeakage: number;
  humanMinutesPerAccept: number;
  inflationRatio: number;
}): MetricsReport {
  return {
    window: { from: '2026-08-11T00:00:00.000Z', to: '2026-08-18T00:00:00.000Z' },
    routing: {
      precision: overrides.precision,
      recall: overrides.recall,
      escalationLeakage: overrides.escalationLeakage,
    },
    efficiency: {
      humanMinutesPerAccept: overrides.humanMinutesPerAccept,
      inflationRatio: overrides.inflationRatio,
    },
  };
}

/** A prior-window line: the generator only reads `key` + `value` from these. */
function previousLine(key: string, value: number): MetricLine {
  return { key, value, previousValue: value, delta: 0, trend: 'FLAT' };
}

function lineByKey(lines: readonly MetricLine[], key: string): MetricLine {
  const line = lines.find((candidate) => candidate.key === key);
  if (!line) throw new Error(`missing line ${key}`);
  return line;
}

const BASE = {
  precision: 0.8,
  recall: 0.7,
  escalationLeakage: 0.1,
  humanMinutesPerAccept: 12,
  inflationRatio: 0.2,
};

describe('ReportGenerator (day-07 §2.1–2.2)', () => {
  it('flattens the metrics report into the stable five-line order', () => {
    const report = generator.generate(currentReport(BASE));
    expect(report.lines.map((line) => line.key)).toEqual([
      'routing.precision',
      'routing.recall',
      'routing.escalationLeakage',
      'efficiency.humanMinutesPerAccept',
      'efficiency.inflationRatio',
    ]);
    expect(report.window.from).toBe('2026-08-11T00:00:00.000Z');
  });

  it('derives delta and trend from the current vs prior value', () => {
    const previous = [
      previousLine('routing.precision', 0.6),
      previousLine('routing.recall', 0.9),
      previousLine('efficiency.humanMinutesPerAccept', 12),
    ];
    const report = generator.generate(currentReport(BASE), previous);

    // 0.8 - 0.6 = +0.2 → UP.
    const precision = lineByKey(report.lines, 'routing.precision');
    expect(precision.delta).toBeCloseTo(0.2, 10);
    expect(precision.trend).toBe('UP');
    expect(precision.previousValue).toBe(0.6);

    // 0.7 - 0.9 = -0.2 → DOWN.
    const recall = lineByKey(report.lines, 'routing.recall');
    expect(recall.delta).toBeCloseTo(-0.2, 10);
    expect(recall.trend).toBe('DOWN');

    // 12 - 12 = 0 → FLAT (within float noise).
    const human = lineByKey(report.lines, 'efficiency.humanMinutesPerAccept');
    expect(human.delta).toBe(0);
    expect(human.trend).toBe('FLAT');
  });

  it('reports UNKNOWN trend and undefined delta when no baseline exists', () => {
    const report = generator.generate(currentReport(BASE));
    for (const line of report.lines) {
      expect(line.previousValue).toBeUndefined();
      expect(line.delta).toBeUndefined();
      expect(line.trend).toBe('UNKNOWN');
    }
  });

  it('emits a guardrail note only when its threshold is crossed', () => {
    // Precision below 0.70 and inflation above 0.30; recall and cost are fine.
    const report = generator.generate(
      currentReport({
        precision: 0.65,
        recall: 0.8,
        escalationLeakage: 0.1,
        humanMinutesPerAccept: 12,
        inflationRatio: 0.4,
      }),
    );
    expect(lineByKey(report.lines, 'routing.precision').guardrail).toContain('0.70');
    expect(lineByKey(report.lines, 'efficiency.inflationRatio').guardrail).toContain('Spec 6 §4.1');
    expect(lineByKey(report.lines, 'routing.recall').guardrail).toBeUndefined();
    expect(lineByKey(report.lines, 'efficiency.humanMinutesPerAccept').guardrail).toBeUndefined();
    // escalationLeakage has no guardrail at all.
    expect(lineByKey(report.lines, 'routing.escalationLeakage').guardrail).toBeUndefined();
  });

  it('flags human cost only as a sharp rise vs the prior window (×1.5)', () => {
    const previous = [previousLine('efficiency.humanMinutesPerAccept', 10)];
    const surged = generator.generate(currentReport({ ...BASE, humanMinutesPerAccept: 16 }), previous);
    expect(lineByKey(surged.lines, 'efficiency.humanMinutesPerAccept').guardrail).toBeDefined();

    const steady = generator.generate(currentReport({ ...BASE, humanMinutesPerAccept: 14 }), previous);
    expect(lineByKey(steady.lines, 'efficiency.humanMinutesPerAccept').guardrail).toBeUndefined();
  });

  it('throws EmptyWindowError when every metric is an honest hole', () => {
    expect(() =>
      generator.generate({
        window: { from: '2026-08-11T00:00:00.000Z', to: '2026-08-18T00:00:00.000Z' },
        routing: {},
        efficiency: {},
      }),
    ).toThrow(EmptyWindowError);
  });

  it('throws EmptyWindowError on a windowless report', () => {
    expect(() =>
      generator.generate({
        window: { from: '', to: '' },
        routing: { precision: 0.8 },
        efficiency: {},
      }),
    ).toThrow(EmptyWindowError);
  });
});

describe('ReportGenerator day-25 shadow/infra/rankMethod rendering (§3.2)', () => {
  it('renders shadow + infra + rankMethod as top-level sections, not metric lines', () => {
    const report = generator.generate({
      ...currentReport(BASE),
      shadow: { comparisons: 2, meanRankCorrelation: 0.6 },
      infra: {
        cacheHitRatio: 0.9,
        sandboxFallbackRate: 0.2,
        sandboxAvgDurationMs: 2000,
        objectIntegrityErrors: 1,
      },
      rankMethod: 'keyword',
    });

    expect(report.shadow).toEqual({ comparisons: 2, meanRankCorrelation: 0.6 });
    expect(report.infra.cacheHitRatio).toBeCloseTo(0.9, 10);
    expect(report.infra.sandboxFallbackRate).toBeCloseTo(0.2, 10);
    expect(report.infra.sandboxAvgDurationMs).toBe(2000);
    expect(report.infra.objectIntegrityErrors).toBe(1);
    expect(report.rankMethod).toBe('keyword');

    // The stable five-line `lines` array is untouched by the new sections.
    expect(report.lines.map((line) => line.key)).toEqual([
      'routing.precision',
      'routing.recall',
      'routing.escalationLeakage',
      'efficiency.humanMinutesPerAccept',
      'efficiency.inflationRatio',
    ]);
  });

  it('defaults shadow + infra + rankMethod when a bare metrics report omits them', () => {
    const report = generator.generate(currentReport(BASE));
    expect(report.shadow).toEqual({ comparisons: 0 });
    expect(report.infra).toEqual({});
    expect(report.rankMethod).toBe('keyword');
  });
});
