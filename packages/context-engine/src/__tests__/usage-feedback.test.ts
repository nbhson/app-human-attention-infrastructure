import { describe, expect, it } from 'vitest';

import { ReRanker } from '../ranking/re-ranker.js';
import { DEFAULT_USAGE_LEARN_CONFIG, UsageLearner, type SourceUsefulness } from '../ranking/usage-learner.js';
import type { RetrievedDoc } from '../retrieval/retriever.js';

const NOW = 1_800_000_000_000;

function mark(sourceId: string, useful: boolean, observedAtMs = NOW): SourceUsefulness {
  return { sourceId, useful, observedAtMs };
}

function doc(sourceId: string, score: number): RetrievedDoc {
  return { sourceId, content: `content:${sourceId}`, score, matchedBy: 'both' };
}

describe('UsageLearner (day-32 §3.2)', () => {
  it('a useful mark bumps a source above neutral (0.5)', () => {
    const learner = new UsageLearner(DEFAULT_USAGE_LEARN_CONFIG, () => NOW);
    const signal = learner.learn([mark('proven.ts', true)]);
    expect(signal.get('proven.ts')).toBeGreaterThan(0.5);
    // Exactly one under-decayed useful mark: 0.5 + 0.2 * 1 = 0.7.
    expect(signal.get('proven.ts')).toBeCloseTo(0.7);
  });

  it('a useless mark demotes a source below neutral (0.5)', () => {
    const learner = new UsageLearner(DEFAULT_USAGE_LEARN_CONFIG, () => NOW);
    const signal = learner.learn([mark('noisy.ts', false)]);
    expect(signal.get('noisy.ts')).toBeLessThan(0.5);
    expect(signal.get('noisy.ts')).toBeCloseTo(0.3);
  });

  it('caps the influence of a single mark at maxSingleMark', () => {
    const learner = new UsageLearner(DEFAULT_USAGE_LEARN_CONFIG, () => NOW);
    // Many useful marks must saturate at maxSignal, not compound unbounded.
    const signal = learner.learn(Array.from({ length: 50 }, () => mark('always.ts', true)));
    expect(signal.get('always.ts')).toBeLessThanOrEqual(DEFAULT_USAGE_LEARN_CONFIG.maxSignal);
    expect(signal.get('always.ts')).toBe(DEFAULT_USAGE_LEARN_CONFIG.maxSignal);
  });

  it('bounds the accumulated signal within [minSignal, maxSignal]', () => {
    const learner = new UsageLearner(DEFAULT_USAGE_LEARN_CONFIG, () => NOW);
    const signal = learner.learn([
      ...Array.from({ length: 50 }, () => mark('good.ts', true)),
      ...Array.from({ length: 50 }, () => mark('bad.ts', false)),
    ]);
    expect(signal.get('good.ts')).toBe(DEFAULT_USAGE_LEARN_CONFIG.maxSignal);
    expect(signal.get('bad.ts')).toBe(DEFAULT_USAGE_LEARN_CONFIG.minSignal);
  });

  it('decays old marks — a mark past the half-life contributes half its weight', () => {
    const halfLife = DEFAULT_USAGE_LEARN_CONFIG.halfLifeMs;
    const fresh = new UsageLearner(DEFAULT_USAGE_LEARN_CONFIG, () => NOW).learn([mark('a.ts', true, NOW)]);
    const stale = new UsageLearner(DEFAULT_USAGE_LEARN_CONFIG, () => NOW).learn([mark('a.ts', true, NOW - halfLife)]);
    expect(fresh.get('a.ts')).toBeCloseTo(0.7);
    // Half-life: 0.5 + 0.2 * 0.5 = 0.6.
    expect(stale.get('a.ts')).toBeCloseTo(0.6);
  });

  it('returns no entry for an unobserved source (re-ranker maps absence to neutral)', () => {
    const learner = new UsageLearner(DEFAULT_USAGE_LEARN_CONFIG, () => NOW);
    const signal = learner.learn([mark('seen.ts', true)]);
    expect(signal.get('seen.ts')).toBeDefined();
    expect(signal.has('unseen.ts')).toBe(false);
  });

  it('accumulates usefulness and uselessness against each other per source', () => {
    const learner = new UsageLearner(DEFAULT_USAGE_LEARN_CONFIG, () => NOW);
    const signal = learner.learn([mark('mixed.ts', true, NOW), mark('mixed.ts', false, NOW)]);
    // +0.2 then −0.2 → back to neutral.
    expect(signal.get('mixed.ts')).toBeCloseTo(0.5);
  });
});

describe('ReRanker learned-usage integration (day-32 §3.3)', () => {
  it('a learned map supersedes raw retrievalCount', () => {
    const reranker = new ReRanker(undefined, undefined, () => NOW);
    // rawCount favors cold.ts (10) over hot.ts (0), but the learned signal flips it.
    const result = reranker.reRank({
      fused: [doc('cold.ts', 1.0), doc('hot.ts', 1.0)],
      changedFiles: [],
      retrievalCount: new Map([
        ['cold.ts', 10],
        ['hot.ts', 0],
      ]),
      learnedUsage: new Map([
        ['cold.ts', 0.2], // marked useless
        ['hot.ts', 0.8], // marked useful
      ]),
    });
    expect(result.map((d) => d.sourceId)).toEqual(['hot.ts', 'cold.ts']);
  });

  it('an observed useful source outranks an unobserved one at equal fusion', () => {
    const reranker = new ReRanker(undefined, undefined, () => NOW);
    const result = reranker.reRank({
      fused: [doc('unseen.ts', 1.0), doc('proven.ts', 1.0)],
      changedFiles: [],
      learnedUsage: new Map([['proven.ts', 0.95]]),
    });
    // unseen.ts has no learned entry → neutral 0.5, below proven.ts's 0.95.
    expect(result.map((d) => d.sourceId)).toEqual(['proven.ts', 'unseen.ts']);
  });

  it('falls back to retrievalCount when no learnedUsage is supplied', () => {
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
});
