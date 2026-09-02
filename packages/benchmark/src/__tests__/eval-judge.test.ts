import { describe, expect, it } from 'vitest';

import type { JudgeScores } from '@harness/domain';

import type { ReviewExample } from '../review-example.js';
import { computeGoldAgreement, evaluateJudgeAgainstGold, reportFromExample } from '../eval-judge.js';
import type { JudgeScorer } from '../eval-judge.js';

function example(overrides: Partial<ReviewExample> = {}): ReviewExample {
  return {
    id: 'eg-1',
    scaleVersion: 'v1',
    labelSet: 'severity-routing-useful',
    source: 'phase2-review-redacted-001',
    prDiff: 'diff --git a/src/service.ts b/src/service.ts\n',
    requirement: 'Add a null guard.',
    report: {
      verdict: 'REQUEST_CHANGES',
      summary: 'Needs a null guard.',
      findings: [
        {
          severity: 'CRITICAL',
          file: 'src/service.ts',
          line: 41,
          message: 'Missing null check.',
          suggestion: 'Guard against null.',
        },
      ],
    },
    gold: { severity: 0.9, routing: 0.8, useful: true },
    createdAt: new Date(0),
    ...overrides,
  };
}

function scores(overrides: Partial<JudgeScores> = {}): JudgeScores {
  return {
    severityAgreement: 0.9,
    routingAgreement: 0.8,
    evidenceSufficiency: 0.7,
    overall: 0.85,
    ...overrides,
  };
}

describe('reportFromExample', () => {
  it('reconstructs a ReviewReport with benchmark provenance and mapped findings', () => {
    const report = reportFromExample(example());

    expect(report.prUrl).toBe('benchmark:phase2-review-redacted-001');
    expect(report.prTitle).toBe('Add a null guard.');
    expect(report.model).toBe('benchmark');
    expect(report.overallVerdict).toBe('REQUEST_CHANGES');
    expect(report.summary).toBe('Needs a null guard.');
    expect(report.findings).toHaveLength(1);

    const finding = report.findings[0]!;
    expect(finding.severity).toBe('CRITICAL');
    expect(finding.file).toBe('src/service.ts');
    expect(finding.line).toBe(41);
    expect(finding.message).toBe('Missing null check.');
    expect(finding.suggestion).toBe('Guard against null.');
  });

  it('accepts an approve-verdict example with no findings', () => {
    const report = reportFromExample(
      example({
        report: { verdict: 'APPROVE', summary: 'LGTM.', findings: [] },
      }),
    );

    expect(report.overallVerdict).toBe('APPROVE');
    expect(report.findings).toEqual([]);
  });
});

describe('computeGoldAgreement', () => {
  it('computes continuous severity/routing agreement and binary usefulness', () => {
    const results = [
      {
        example: example(),
        judge: scores({ severityAgreement: 0.9, routingAgreement: 0.8, overall: 0.85 }),
      },
      {
        example: example({ id: 'eg-2', gold: { severity: 0.1, routing: 0.4, useful: false } }),
        judge: scores({ severityAgreement: 0.1, routingAgreement: 0.2, overall: 0.2 }),
      },
    ];

    const agreement = computeGoldAgreement(results);

    // severity:    1 - (|0.9-0.9| + |0.1-0.1|)/2 = 1
    // routing:     1 - (|0.8-0.8| + |0.2-0.4|)/2 = 0.9
    // usefulness:  (true->true) + (false->false) = 2/2 = 1
    expect(agreement.severity).toBeCloseTo(1);
    expect(agreement.routing).toBeCloseTo(0.9);
    expect(agreement.usefulness).toBeCloseTo(1);
  });

  it('scores a usefulness miss when the judge predicts useful but gold does not', () => {
    const results = [
      {
        example: example({ gold: { severity: 0.9, routing: 0.8, useful: false } }),
        judge: scores({ overall: 0.85 }),
      },
    ];

    expect(computeGoldAgreement(results).usefulness).toBe(0);
  });

  it('throws on an empty result set', () => {
    expect(() => computeGoldAgreement([])).toThrow(/at least one judged example/);
  });
});

describe('evaluateJudgeAgainstGold', () => {
  it('runs the scorer over every example and returns agreement plus results', async () => {
    const scorer: JudgeScorer = async () => scores();
    const examples = [example(), example({ id: 'eg-2', gold: { severity: 0.9, routing: 0.8, useful: true } })];

    const result = await evaluateJudgeAgainstGold(examples, scorer);

    expect(result.n).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.agreement.severity).toBeCloseTo(1);
    expect(result.agreement.usefulness).toBeCloseTo(1);
  });

  it('throws on an empty example list', async () => {
    const scorer: JudgeScorer = async () => scores();
    await expect(evaluateJudgeAgainstGold([], scorer)).rejects.toThrow(/at least one example/);
  });
});
