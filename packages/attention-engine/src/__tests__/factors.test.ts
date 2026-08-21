import { describe, expect, it } from 'vitest';

import {
  extractComplexity,
  extractConfidence,
  extractImpact,
  extractNovelty,
  extractRisk,
} from '../factors.js';

describe('extractRisk', () => {
  it('maps each verdict to its base score', () => {
    expect(extractRisk('FAILED', [])).toBeCloseTo(0.9, 6);
    expect(extractRisk('FLAKY', [])).toBeCloseTo(0.6, 6);
    expect(extractRisk('TIMED_OUT', [])).toBeCloseTo(0.7, 6);
    expect(extractRisk('PASSED', [])).toBeCloseTo(0.1, 6);
  });

  it('adds 0.1 for a secrets-adjacent path, capped at 1.0', () => {
    expect(extractRisk('PASSED', ['.env.local'])).toBeCloseTo(0.2, 6);
    expect(extractRisk('FAILED', ['.env'])).toBe(1); // 0.9 + 0.1 → capped
  });

  it('returns null when there is no verification report', () => {
    expect(extractRisk(null, [])).toBeNull();
  });
});

describe('extractImpact', () => {
  it('blends file count 50/50 with path criticality', () => {
    // 1 non-critical file: 0.5·0.1 + 0.5·0.1 = 0.1
    expect(extractImpact(1, ['src/a.ts'])).toBeCloseTo(0.1, 6);
    // 1 critical path counts double: 0.5·0.1 + 0.5·0.2 = 0.15
    expect(extractImpact(1, ['packages/domain/x.ts'])).toBeCloseTo(0.15, 6);
    expect(extractImpact(1, ['migrations/0001_up.sql'])).toBeCloseTo(0.15, 6);
  });

  it('returns null when no files are known', () => {
    expect(extractImpact(0, [])).toBeNull();
  });

  it('caps the blend at 1 for many critical files', () => {
    const paths = Array<string>(10).fill('packages/domain/x.ts');
    expect(extractImpact(10, paths)).toBe(1);
  });
});

describe('extractNovelty', () => {
  it('decays from 1.0 for unseen, to 0.2 once seen thrice', () => {
    expect(extractNovelty(0)).toBe(1);
    expect(extractNovelty(1)).toBeCloseTo(0.7, 6);
    expect(extractNovelty(2)).toBeCloseTo(0.4, 6);
    expect(extractNovelty(3)).toBeCloseTo(0.2, 6);
    expect(extractNovelty(10)).toBeCloseTo(0.2, 6);
  });
});

describe('extractComplexity', () => {
  it('returns zero for an empty diff and single-step run', () => {
    expect(extractComplexity(0, 0, 0)).toBe(0);
  });

  it('blends the line ratio 50/50 with the trajectory-step ratio', () => {
    // 250 added lines (ratio 0.5) + 0 steps → 0.25
    expect(extractComplexity(250, 0, 0)).toBeCloseTo(0.25, 6);
    // 0 lines + 10 steps (ratio 0.5) → 0.25
    expect(extractComplexity(0, 0, 10)).toBeCloseTo(0.25, 6);
  });

  it('caps both halves at their maxima', () => {
    expect(extractComplexity(500, 0, 20)).toBeCloseTo(1, 6);
  });
});

describe('extractConfidence', () => {
  it('derives the proxy from the verification verdict', () => {
    expect(extractConfidence('PASSED', 0)).toBeCloseTo(0.9, 6);
    expect(extractConfidence('FLAKY', 0)).toBeCloseTo(0.4, 6);
    expect(extractConfidence('TIMED_OUT', 0)).toBeCloseTo(0.3, 6);
    expect(extractConfidence('FAILED', 0)).toBeCloseTo(0.1, 6);
  });

  it('lowers confidence with retry pressure', () => {
    // 1 − (0.1 + 2·0.15) = 1 − 0.4 = 0.6
    expect(extractConfidence('PASSED', 2)).toBeCloseTo(0.6, 6);
  });

  it('returns null only when both signals are absent', () => {
    expect(extractConfidence(null, 0)).toBeNull();
    // 1 − (0 + 1·0.15) = 0.85
    expect(extractConfidence(null, 1)).toBeCloseTo(0.85, 6);
  });

  it('caps retry risk at 0.5', () => {
    // 1 − (0.1 + min(0.5, 4·0.15)) = 1 − 0.6 = 0.4
    expect(extractConfidence('PASSED', 4)).toBeCloseTo(0.4, 6);
  });
});
