import { describe, expect, it } from 'vitest';

import {
  priorityFromRiskScore,
  riskScoreFromSeverities,
  summaryFromPayload,
} from '../list-summary.js';

describe('summaryFromPayload', () => {
  it('flattens author, branches, and summed diff stats', () => {
    const summary = summaryFromPayload({
      author: 'octocat',
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      files: [
        { path: 'a.ts', additions: 3, deletions: 1 },
        { path: 'b.ts', additions: 10, deletions: 4 },
      ],
    });

    expect(summary).toEqual({
      author: 'octocat',
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      additions: 13,
      deletions: 5,
      filesChanged: 2,
    });
  });

  it('is safe against the empty {} payload the decision-route tests seed', () => {
    expect(summaryFromPayload({})).toEqual({
      author: null,
      sourceBranch: null,
      targetBranch: null,
      additions: 0,
      deletions: 0,
      filesChanged: 0,
    });
  });

  it('is safe against null, non-object, and malformed inputs', () => {
    const empty = {
      author: null,
      sourceBranch: null,
      targetBranch: null,
      additions: 0,
      deletions: 0,
      filesChanged: 0,
    };
    expect(summaryFromPayload(null)).toEqual(empty);
    expect(summaryFromPayload('nope')).toEqual(empty);
    expect(summaryFromPayload({ files: 'nope' })).toEqual(empty);
    expect(summaryFromPayload({ author: 42, sourceBranch: '', targetBranch: 'main' })).toEqual({
      ...empty,
      targetBranch: 'main',
    });
  });

  it('coerces non-numeric, negative, and missing line counts to zero', () => {
    expect(
      summaryFromPayload({
        files: [{ additions: -1, deletions: 'nope' }, { additions: undefined }, { path: 'a.ts' }],
      }),
    ).toMatchObject({ additions: 0, deletions: 0, filesChanged: 3 });
  });
});

describe('riskScoreFromSeverities', () => {
  it('sums the documented weights', () => {
    expect(riskScoreFromSeverities([])).toBe(0);
    expect(riskScoreFromSeverities(['INFO'])).toBe(0);
    expect(riskScoreFromSeverities(['NIT'])).toBe(2);
    expect(riskScoreFromSeverities(['MINOR'])).toBe(6);
    expect(riskScoreFromSeverities(['MAJOR'])).toBe(15);
    expect(riskScoreFromSeverities(['CRITICAL'])).toBe(35);
    expect(riskScoreFromSeverities(['CRITICAL', 'MAJOR', 'MINOR', 'NIT', 'INFO'])).toBe(58);
  });

  it('ignores unknown severities and clamps to the 0..100 range', () => {
    expect(riskScoreFromSeverities(['CRITICAL', 'UNKNOWN'])).toBe(35);
    expect(riskScoreFromSeverities(Array<string>(4).fill('CRITICAL'))).toBe(100);
  });
});

describe('priorityFromRiskScore', () => {
  it('maps scores onto the high/medium/low tiers at the documented boundaries', () => {
    expect(priorityFromRiskScore(100)).toBe('high');
    expect(priorityFromRiskScore(30)).toBe('high');
    expect(priorityFromRiskScore(29)).toBe('medium');
    expect(priorityFromRiskScore(10)).toBe('medium');
    expect(priorityFromRiskScore(9)).toBe('low');
    expect(priorityFromRiskScore(0)).toBe('low');
    expect(priorityFromRiskScore(-5)).toBe('low');
  });

  it('composes with riskScoreFromSeverities sensibly', () => {
    expect(priorityFromRiskScore(riskScoreFromSeverities(['CRITICAL']))).toBe('high');
    expect(priorityFromRiskScore(riskScoreFromSeverities(['MAJOR']))).toBe('medium');
    expect(priorityFromRiskScore(riskScoreFromSeverities(['MINOR', 'MINOR']))).toBe('medium');
    expect(priorityFromRiskScore(riskScoreFromSeverities(['NIT']))).toBe('low');
  });
});
