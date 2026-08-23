import { describe, expect, it } from 'vitest';

import { ReRanker } from '../ranking/re-ranker.js';
import { dependencySignal, recencySignal, usageSignal } from '../ranking/signals.js';
import type { RetrievedDoc } from '../retrieval/retriever.js';

/** A fixed clock (ms epoch) so recency is deterministic. */
const NOW = 1_800_000_000_000;

function doc(sourceId: string, score: number): RetrievedDoc {
  return { sourceId, content: `content:${sourceId}`, score, matchedBy: 'both' };
}

describe('ReRanker (day-27 §2.2)', () => {
  it('preserves the fusion order when every extra signal is absent (neutral)', () => {
    const reranker = new ReRanker(undefined, undefined, () => NOW);
    const fused = [doc('a', 2), doc('b', 1), doc('c', 0.5)];

    expect(reranker.reRank({ fused, changedFiles: [] }).map((d) => d.sourceId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('re-orders by dependency proximity when the resolver reports it', () => {
    // a has the higher fusion score but is unrelated; b is the changed file itself.
    const resolver = (changed: readonly string[], candidate: string): number | null =>
      candidate === 'b' ? 1.0 : candidate === 'a' ? 0.1 : null;
    const reranker = new ReRanker(resolver, undefined, () => NOW);

    const result = reranker.reRank({ fused: [doc('a', 1.0), doc('b', 0.9)], changedFiles: ['b'] });
    expect(result.map((d) => d.sourceId)).toEqual(['b', 'a']);
  });

  it('re-orders by recency (fresher file wins when fusion is equal)', () => {
    const reranker = new ReRanker(undefined, undefined, () => NOW);
    const result = reranker.reRank({
      fused: [doc('old.ts', 1.0), doc('fresh.ts', 1.0)],
      changedFiles: [],
      // old.ts touched 100 days ago → near-0 recency; fresh.ts touched now → 1.0.
      mtimeMs: new Map([
        ['old.ts', NOW - 100 * 24 * 60 * 60 * 1000],
        ['fresh.ts', NOW],
      ]),
    });
    expect(result.map((d) => d.sourceId)).toEqual(['fresh.ts', 'old.ts']);
  });

  it('re-orders by usage (more-retrieved file wins when fusion is equal)', () => {
    const reranker = new ReRanker(undefined, undefined, () => NOW);
    const result = reranker.reRank({
      fused: [doc('cold.ts', 1.0), doc('hot.ts', 1.0)],
      changedFiles: [],
      retrievalCount: new Map([
        ['cold.ts', 0],
        ['hot.ts', 10],
      ]),
    });
    expect(result.map((d) => d.sourceId)).toEqual(['hot.ts', 'cold.ts']);
  });

  it('never widens the candidate set — a pure 1:1 re-order', () => {
    const resolver = () => 0.1;
    const reranker = new ReRanker(resolver, undefined, () => NOW);
    const fused = [doc('a', 1), doc('b', 0.4), doc('c', 0.3)];

    const result = reranker.reRank({ fused, changedFiles: ['b'] });
    expect(result.map((d) => d.sourceId).sort()).toEqual(['a', 'b', 'c']);
    expect(result).toHaveLength(3);
  });

  it('breaks exact ties deterministically by sourceId ascending', () => {
    const reranker = new ReRanker(undefined, undefined, () => NOW);
    // Equal score + no extra signals → identical final relevance.
    const result = reranker.reRank({ fused: [doc('z.ts', 1), doc('a.ts', 1)], changedFiles: [] });
    expect(result.map((d) => d.sourceId)).toEqual(['a.ts', 'z.ts']);
  });
});

describe('re-rank signals (day-27 §2.4)', () => {
  it('dependencySignal is neutral when the resolver is absent or cold', () => {
    expect(dependencySignal(undefined, ['a'], 'b')).toBe(0.5);
    expect(dependencySignal(() => null, ['a'], 'b')).toBe(0.5);
    expect(
      dependencySignal((_changed, candidate) => (candidate === 'b' ? 1.0 : 0.1), ['a'], 'b'),
    ).toBe(1.0);
  });

  it('recencySignal decays with age and is neutral when mtime is absent', () => {
    expect(recencySignal(undefined, NOW)).toBe(0.5);
    expect(recencySignal(NOW, NOW)).toBe(1);
    expect(recencySignal(NOW - 30 * 24 * 60 * 60 * 1000, NOW)).toBeCloseTo(Math.exp(-1));
    // Future/clock-skewed mtime clamps to age 0, not a negative decay.
    expect(recencySignal(NOW + 1000, NOW)).toBe(1);
  });

  it('usageSignal saturates and is neutral only when the counter is absent', () => {
    expect(usageSignal(undefined)).toBe(0.5);
    expect(usageSignal(0)).toBe(0); // a real zero, not a missing signal
    expect(usageSignal(10)).toBe(1);
    expect(usageSignal(20)).toBe(1); // saturates
  });
});
