import { describe, expect, it } from 'vitest';

import { testingHealthForFiles, withDeterministicTestingScore } from './review-health.js';

describe('testingHealthForFiles', () => {
  it('rates 2 test / 3 source files excellent (~90), not poor', () => {
    // The reported case: two test files alongside three source files.
    expect(
      testingHealthForFiles([
        'shop-web/src/api/checkout/payment.api.ts',
        'shop-web/src/api/checkout/payment.api.test.ts',
        'shop-web/src/services/cart/cart.service.ts',
        'shop-web/src/components/cart/cart-drawer.component.test.ts',
        'shop-web/src/components/cart/cart-drawer.component.ts',
        'shop-web/src/styles/theme.scss',
      ]),
    ).toEqual({ rating: 'excellent', score: 90 });
  });

  it('maps the rubric bands at their boundaries', () => {
    // 1/2 = 50% → excellent floor (uses .test.ts variant).
    expect(testingHealthForFiles(['a.test.ts', 'b.ts', 'c.ts'])?.rating).toBe('excellent');
    // 1/3 ≈ 33% → good (uses .spec.tsx variant).
    expect(testingHealthForFiles(['a.spec.tsx', 'b.ts', 'c.ts', 'd.ts'])?.rating).toBe('good');
    // 1/10 = 10% → fair (uses .test.tsx variant).
    expect(
      testingHealthForFiles([
        'a.test.tsx',
        'b.ts',
        'c.ts',
        'd.ts',
        'e.ts',
        'f.ts',
        'g.ts',
        'h.ts',
        'i.ts',
        'j.ts',
        'k.ts',
      ])?.rating,
    ).toBe('fair');
    // 0 tests with source changes → poor.
    expect(testingHealthForFiles(['b.ts', 'c.ts'])).toEqual({ rating: 'poor', score: 15 });
  });

  it('detects .spec.ts/.test.ts variants and rejects the .spect.ts typo', () => {
    // Every JS/TS test suffix counts as a test file.
    for (const testFile of [
      'src/a.spec.ts',
      'src/a.test.ts',
      'src/a.spec.tsx',
      'src/a.test.tsx',
      'src/a.spec.js',
      'src/a.test.js',
      'src/a.spec.jsx',
      'src/a.test.mjs',
    ]) {
      expect(testingHealthForFiles([testFile, 'src/b.ts'])?.rating).toBe('excellent');
    }
    // Uppercase still matches (/i).
    expect(testingHealthForFiles(['SRC/A.SPEC.TS', 'src/b.ts'])?.rating).toBe('excellent');
    // Typo .spect.ts is not a test suffix → 0 tests / 2 sources → poor.
    expect(testingHealthForFiles(['src/a.spect.ts', 'src/b.ts'])).toEqual({ rating: 'poor', score: 15 });
  });

  it('rates tests-only changes excellent and ignores generated artifacts', () => {
    expect(testingHealthForFiles(['src/a.spec.ts', 'src/b.spec.ts'])).toEqual({
      rating: 'excellent',
      score: 95,
    });
    // pnpm-lock.yaml is generated, not source — the ratio is 1 test / 1 source.
    expect(testingHealthForFiles(['pnpm-lock.yaml', 'src/a.spec.ts', 'src/b.ts'])?.rating).toBe('excellent');
  });

  it('returns null when there is no test/source signal (docs-only change)', () => {
    expect(testingHealthForFiles(['README.md', 'Dockerfile'])).toBeNull();
    expect(testingHealthForFiles([])).toBeNull();
  });
});

describe('withDeterministicTestingScore', () => {
  const stored = {
    architecture: 'excellent',
    codeQuality: 'excellent',
    security: 'excellent',
    performance: 'excellent',
    testing: 'poor',
    overallRisk: 'LOW',
    architectureScore: 95,
    codeQualityScore: 98,
    securityScore: 100,
    performanceScore: 100,
    testingScore: 1,
    overallRiskScore: 10,
  };

  it('overrides only the testing dimension, preserving everything else', () => {
    expect(withDeterministicTestingScore(stored, ['a.spec.ts', 'b.ts', 'c.ts'])).toEqual({
      ...stored,
      testing: 'excellent',
      // 1 test / 2 source = 50% → excellent floor.
      testingScore: 85,
    });
  });

  it('passes through null and signal-less diffs untouched', () => {
    expect(withDeterministicTestingScore(null, ['a.spec.ts', 'b.ts'])).toBeNull();
    expect(withDeterministicTestingScore(stored, ['README.md'])).toBe(stored);
  });

  it('is idempotent on an already-corrected score', () => {
    const files = ['a.spec.ts', 'b.spec.ts', 'c.ts', 'd.ts', 'e.ts'];
    const once = withDeterministicTestingScore(stored, files);
    expect(withDeterministicTestingScore(once, files)).toEqual(once);
  });
});
