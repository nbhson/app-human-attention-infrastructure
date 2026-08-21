import { describe, expect, it } from 'vitest';

import type { RankedFile } from '../rank.js';
import { applyBudget, DEFAULT_CONTEXT_POLICY, TRUNCATION_MARKER } from '../trim.js';
import { ApproxTokenizer } from '../types.js';

const tokenizer = new ApproxTokenizer();

function file(sourceId: string, content: string, relevanceScore: number): RankedFile {
  return { sourceId, content, relevanceScore };
}

describe('applyBudget', () => {
  it('never drops a target file, even when it alone exceeds the budget', () => {
    const { sources, totalTokens } = applyBudget([file('target.ts', 'x'.repeat(400), 0.1)], {
      targetFiles: ['target.ts'],
      tokenizer,
      maxTokens: 50,
      policy: DEFAULT_CONTEXT_POLICY,
    });

    expect(sources.map((s) => s.sourceId)).toEqual(['target.ts']);
    expect(totalTokens).toBe(100); // 400 chars / 4, kept in full despite the 50-token budget
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
});
