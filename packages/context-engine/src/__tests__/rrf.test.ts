import { describe, expect, it } from 'vitest';

import { reciprocalRankFusion, RRF_K } from '../retrieval/rrf.js';

describe('reciprocalRankFusion', () => {
  it('scores by 1/(k+rank) and fuses overlap', () => {
    // lexical: [a, b, c]; semantic: [c]  → c = 1/(k+3) + 1/(k+1) wins, then a, then b.
    const result = reciprocalRankFusion([['a', 'b', 'c'], ['c']]);
    expect(result.map((r) => r.sourceId)).toEqual(['c', 'a', 'b']);
    expect(result[0]?.score).toBeCloseTo(1 / (RRF_K + 3) + 1 / (RRF_K + 1));
    expect(result[1]?.score).toBeCloseTo(1 / (RRF_K + 1));
    expect(result[2]?.score).toBeCloseTo(1 / (RRF_K + 2));
  });

  it('ties break by sourceId ascending for determinism', () => {
    // Both a and b appear once at rank 1 → identical score.
    const result = reciprocalRankFusion([['a'], ['b']]);
    expect(result[0]?.score).toBeCloseTo(result[1]?.score as number);
    expect(result.map((r) => r.sourceId)).toEqual(['a', 'b']);
  });

  it('skips duplicate sourceIds within a single layer', () => {
    // 'a' listed twice in one layer still gets one rank slot, not two.
    const result = reciprocalRankFusion([['a', 'a', 'b']]);
    expect(result.map((r) => r.sourceId)).toEqual(['a', 'b']);
    expect(result[0]?.score).toBeCloseTo(1 / (RRF_K + 1));
    expect(result[1]?.score).toBeCloseTo(1 / (RRF_K + 2));
  });

  it('returns [] for empty input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it('is deterministic: same input always produces same order', () => {
    const input = [
      ['z', 'a', 'm'],
      ['a', 'b', 'z'],
    ];
    const r1 = reciprocalRankFusion(input);
    const r2 = reciprocalRankFusion(input);
    expect(r1.map((r) => r.sourceId)).toEqual(r2.map((r) => r.sourceId));
  });
});
