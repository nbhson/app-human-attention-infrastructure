import { describe, expect, it } from 'vitest';

import { dependencyProximity, keywordOverlap, relevanceScore } from '../rank.js';

describe('keywordOverlap', () => {
  it('is zero when the task contributes no keywords', () => {
    expect(keywordOverlap(new Set(), 'anything at all')).toBe(0);
  });

  it('is hits / keyword-count (Jaccard-lite)', () => {
    expect(keywordOverlap(new Set(['logging', 'api', 'auth']), 'add logging to the api layer')).toBeCloseTo(2 / 3, 6);
  });

  it('is zero when nothing overlaps', () => {
    expect(keywordOverlap(new Set(['payment']), 'logging and observability')).toBe(0);
  });
});

describe('dependencyProximity', () => {
  it('is 1.0 for a target file', () => {
    expect(dependencyProximity('src/a.ts', ['src/a.ts'])).toBe(1.0);
  });

  it('is 0.6 for a sibling in the same directory', () => {
    expect(dependencyProximity('src/b.ts', ['src/a.ts'])).toBe(0.6);
  });

  it('is 0.1 otherwise', () => {
    expect(dependencyProximity('lib/b.ts', ['src/a.ts'])).toBe(0.1);
  });
});

describe('relevanceScore', () => {
  it('applies the 0.7 / 0.3 Phase-1 weights', () => {
    expect(relevanceScore(0.5, 1.0)).toBeCloseTo(0.65, 6);
    expect(relevanceScore(0.0, 0.0)).toBe(0);
  });
});
