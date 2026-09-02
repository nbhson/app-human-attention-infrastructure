import { describe, expect, it, vi } from 'vitest';

import type { LLMProvider, LLMResponse } from '@harness/domain';
import type { Logger } from '@harness/di';

import { parseVariants, LLMQueryRewriter, MAX_VARIANT_COUNT } from '../retrieval/query-rewriter.js';
import { RagFusionRetriever } from '../retrieval/rag-fusion-retriever.js';
import type { RetrievedDoc, Retriever, RetrievalQuery } from '../retrieval/retriever.js';
import {
  RetrieverFactory,
  RANK_METHOD_HYBRID,
  RANK_METHOD_KEYWORD,
  RANK_METHOD_RAG_FUSION,
} from '../retrieval/retriever-factory.js';

const noopLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => noopLogger,
};

const QUERY: RetrievalQuery = {
  text: 'payment refund',
  targetFiles: [],
  documents: [{ sourceId: 'src/Payment.ts', content: 'payment' }],
};

function doc(sourceId: string, matchedBy: RetrievedDoc['matchedBy'] = 'lexical'): RetrievedDoc {
  return { sourceId, content: `content:${sourceId}`, score: 1, matchedBy };
}

/** A `Retriever` whose results depend on the query text. */
function baseByQuery(map: Record<string, RetrievedDoc[]>, method = 'hybrid'): Retriever {
  return { method, retrieve: async (q) => map[q.text] ?? [] };
}

function fakeLLM(content: string): LLMProvider {
  const response: LLMResponse = {
    content,
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: 'end_turn',
  };
  return { complete: async () => response };
}

describe('parseVariants / LLMQueryRewriter (day-28 §3.1)', () => {
  it('parses numbered, bulleted, and blank lines into de-duplicated variants', () => {
    expect(parseVariants('1. refund payment\n- pay refund\n\nRefund payment\n', 3)).toEqual([
      'refund payment',
      'pay refund',
    ]);
  });

  it('caps the variant count regardless of output size', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((i) => `query ${i}`).join('\n');
    expect(parseVariants(many, MAX_VARIANT_COUNT)).toHaveLength(MAX_VARIANT_COUNT);
  });

  it('rewrites through the LLMProvider seam and clamps k to the cap', async () => {
    const rewriter = new LLMQueryRewriter(fakeLLM('q1\nq2\nq3\nq4\nq5\nq6'), 'test-model');
    const variants = await rewriter.rewrite('original', 99);
    expect(variants).toHaveLength(MAX_VARIANT_COUNT);
  });

  it('throws when the rewrite produces no usable variant (never empty-silently)', async () => {
    const rewriter = new LLMQueryRewriter(fakeLLM('\n  \n'), 'test-model');
    await expect(rewriter.rewrite('original')).rejects.toThrow(/no usable variants/);
  });
});

describe('RagFusionRetriever (day-28 §2.1)', () => {
  it('retrieves per variant and fuses the union via RRF', async () => {
    const base = baseByQuery({
      'payment refund': [doc('a', 'lexical'), doc('b', 'lexical')],
      'pay refund': [doc('b', 'semantic'), doc('c', 'semantic')],
      payback: [doc('c', 'semantic')],
    });
    const rewriter = { rewrite: async () => ['pay refund', 'payback'] };
    const fusion = new RagFusionRetriever(base, rewriter, 2);

    const result = await fusion.retrieve(QUERY);
    // b and c both accrue 1/62+1/61; a only 1/61 → b > c (tie-break) > a.
    expect(result.map((d) => d.sourceId)).toEqual(['b', 'c', 'a']);
    expect(result.find((d) => d.sourceId === 'b')?.matchedBy).toBe('both');
    expect(result.find((d) => d.sourceId === 'a')?.matchedBy).toBe('lexical');
  });

  it('falls back to a single-query base result when the rewriter throws (§2.3)', async () => {
    const base = baseByQuery({ 'payment refund': [doc('a')] });
    const rewriter = {
      rewrite: vi.fn(async () => {
        throw new Error('llm down');
      }),
    };
    const fusion = new RagFusionRetriever(base, rewriter);

    const result = await fusion.retrieve(QUERY);
    expect(result.map((d) => d.sourceId)).toEqual(['a']); // non-empty
    expect(rewriter.rewrite).toHaveBeenCalledTimes(1);
  });

  it('falls back when the rewriter returns no variants', async () => {
    const base = baseByQuery({ 'payment refund': [doc('a')] });
    const fusion = new RagFusionRetriever(base, { rewrite: async () => [] });

    expect((await fusion.retrieve(QUERY)).map((d) => d.sourceId)).toEqual(['a']);
  });

  it('runs the base retriever once per query (original + variants), concurrently', async () => {
    const asked: string[] = [];
    const base: Retriever = {
      method: 'hybrid',
      retrieve: async (q) => {
        asked.push(q.text);
        return [doc(q.text)];
      },
    };
    const fusion = new RagFusionRetriever(base, { rewrite: async () => ['v1', 'v2'] }, 2);

    await fusion.retrieve(QUERY);
    expect(asked.sort()).toEqual(['payment refund', 'v1', 'v2']);
  });
});

describe('RetrieverFactory (day-28 §3.3)', () => {
  it('swaps keyword / hybrid / rag_fusion through one seam, default keyword', async () => {
    const keyword = baseByQuery({ x: [doc('x')] }, 'keyword');
    const semantic = baseByQuery({ x: [doc('x', 'semantic')] });
    const rewriter = { rewrite: async () => ['x'] };
    const factory = new RetrieverFactory(keyword, noopLogger, undefined, semantic, rewriter);

    expect((await factory.resolve(undefined))?.method).toBe(RANK_METHOD_KEYWORD);
    expect((await factory.resolve(RANK_METHOD_KEYWORD))?.method).toBe(RANK_METHOD_KEYWORD);
    expect((await factory.resolve(RANK_METHOD_HYBRID))?.method).toBe(RANK_METHOD_HYBRID);
    expect((await factory.resolve(RANK_METHOD_RAG_FUSION))?.method).toBe(RANK_METHOD_RAG_FUSION);
  });

  it('degrades hybrid and rag_fusion to keyword when their deps are missing', async () => {
    const keyword = baseByQuery({ x: [doc('x')] }, 'keyword');
    const factory = new RetrieverFactory(keyword, noopLogger);
    expect((await factory.resolve(RANK_METHOD_HYBRID))?.method).toBe(RANK_METHOD_KEYWORD);
    expect((await factory.resolve(RANK_METHOD_RAG_FUSION))?.method).toBe(RANK_METHOD_KEYWORD);
  });
});
