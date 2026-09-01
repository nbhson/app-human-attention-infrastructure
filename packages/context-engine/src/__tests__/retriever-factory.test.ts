import { describe, expect, it } from 'vitest';

import {
  RetrieverFactory,
  RANK_METHOD_HYBRID,
  RANK_METHOD_KEYWORD,
  RANK_METHOD_RAG_FUSION,
} from '../retrieval/retriever-factory.js';

/** A fake retriever that returns fixed docs. */
function fake(method: string) {
  return { method, retrieve: async () => [] };
}

describe('RetrieverFactory', () => {
  it('defaults to keyword and selects hybrid only when named', () => {
    const keyword = fake('keyword');
    const semantic = fake('semantic');
    const factory = new RetrieverFactory(keyword, semantic);

    expect(factory.resolve(undefined)?.method).toBe(RANK_METHOD_KEYWORD);
    expect(factory.resolve('keyword')?.method).toBe(RANK_METHOD_KEYWORD);
    expect(factory.resolve(RANK_METHOD_HYBRID)?.method).toBe(RANK_METHOD_HYBRID);
  });

  it('degrades unknown and hybrid-without-semantic to keyword (never a crash)', () => {
    const keyword = fake('keyword');
    // No semantic layer wired → hybrid is unreachable, resolves to keyword.
    const noSemantic = new RetrieverFactory(keyword);
    expect(noSemantic.resolve(RANK_METHOD_HYBRID)?.method).toBe(RANK_METHOD_KEYWORD);

    const factory = new RetrieverFactory(keyword);
    expect(factory.resolve('rag_fusion')?.method).toBe(RANK_METHOD_KEYWORD);
  });

  it('selects rag_fusion when all dependencies are wired', () => {
    const keyword = fake('keyword');
    const semantic = fake('semantic');
    const rewriter = { rewrite: async (q: string) => [q] };
    const factory = new RetrieverFactory(keyword, semantic, rewriter as never);
    expect(factory.resolve(RANK_METHOD_RAG_FUSION)?.method).toBe(RANK_METHOD_RAG_FUSION);
  });
});
