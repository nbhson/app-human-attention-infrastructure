import { describe, expect, it } from 'vitest';

import type { RankedFile } from '../rank.js';
import { applyBudget, DEFAULT_CONTEXT_POLICY, TRUNCATION_MARKER } from '../trim.js';
import { TiktokenTokenizer } from '../tiktoken-tokenizer.js';

const tokenizer = new TiktokenTokenizer('cl100k_base');

function file(sourceId: string, content: string, relevanceScore: number): RankedFile {
  return { sourceId, content, relevanceScore };
}

describe('applyBudget', () => {
  it('never drops a target file, even when it alone exceeds the budget', () => {
    const content = 'x'.repeat(1000); // 125 exact tokens, well over the 50 budget
    const { sources, totalTokens } = applyBudget([file('target.ts', content, 0.1)], {
      targetFiles: ['target.ts'],
      tokenizer,
      maxTokens: 50,
      policy: DEFAULT_CONTEXT_POLICY,
    });

    expect(sources.map((s) => s.sourceId)).toEqual(['target.ts']);
    // Kept in full: totalTokens is the exact count of the source, not chars/4.
    expect(totalTokens).toBe(tokenizer.count(content));
  });

  it('keeps a target file even below the relevance threshold', () => {
    const { sources } = applyBudget([file('target.ts', 'x', 0.01)], {
      targetFiles: ['target.ts'],
      tokenizer,
      maxTokens: 10,
      policy: DEFAULT_CONTEXT_POLICY,
    });

    expect(sources).toHaveLength(1);
  });

  it('drops sources below minRelevanceThreshold', () => {
    const { sources } = applyBudget([file('high.ts', 'x', 0.9), file('low.ts', 'y', 0.05)], {
      targetFiles: [],
      tokenizer,
      maxTokens: 100,
      policy: DEFAULT_CONTEXT_POLICY,
    });

    expect(sources.map((s) => s.sourceId)).toEqual(['high.ts']);
  });

  it('truncates the first source that does not fit and drops the rest', () => {
    const { sources, totalTokens } = applyBudget(
      [file('big.ts', 'a'.repeat(1000), 0.9), file('tail.ts', 'b'.repeat(1000), 0.8)],
      { targetFiles: [], tokenizer, maxTokens: 100, policy: DEFAULT_CONTEXT_POLICY },
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]?.sourceId).toBe('big.ts');
    expect(sources[0]?.content.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(totalTokens).toBeLessThanOrEqual(100);
  });

  it('caps the number of non-target sources at maxSources', () => {
    const ranked = [0, 1, 2, 3, 4, 5].map((i) => file(`f${i}.ts`, 'x', 0.9 - i * 0.01));
    const { sources } = applyBudget(ranked, {
      targetFiles: [],
      tokenizer,
      maxTokens: 1000,
      policy: { ...DEFAULT_CONTEXT_POLICY, maxSources: 3 },
    });

    expect(sources).toHaveLength(3);
  });

  it('keeps in full a file chars/4 would have truncated (day-19 §2.3)', () => {
    // 100 spaces: chars/4 = 25 tokens (over a 10-token budget → truncated), but
    // exact cl100k_base = 2 tokens (fits → kept verbatim). This is the load-bearing
    // regression the token swap exists to surface.
    const content = ' '.repeat(100);
    const { sources, totalTokens } = applyBudget([file('pad.ts', content, 0.9)], {
      targetFiles: [],
      tokenizer,
      maxTokens: 10,
      policy: DEFAULT_CONTEXT_POLICY,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.content).toBe(content); // no marker, no truncation
    expect(totalTokens).toBe(tokenizer.count(content)); // 2, not 25
  });
});
