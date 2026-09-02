import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@harness/di';

import {
  EnvRankDefaultProvider,
  RANK_METHOD_HYBRID,
  RANK_METHOD_KEYWORD,
  RANK_METHOD_RAG_FUSION,
  RetrieverFactory,
} from '../retrieval/retriever-factory.js';

const noopLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => noopLogger,
};

/** A fake retriever that returns fixed docs. */
function fake(method: string) {
  return { method, retrieve: async () => [] };
}

describe('RetrieverFactory', () => {
  it('defaults to keyword and selects hybrid only when named', async () => {
    const keyword = fake('keyword');
    const semantic = fake('semantic');
    const factory = new RetrieverFactory(keyword, noopLogger, undefined, semantic);

    expect((await factory.resolve(undefined))?.method).toBe(RANK_METHOD_KEYWORD);
    expect((await factory.resolve('keyword'))?.method).toBe(RANK_METHOD_KEYWORD);
    expect((await factory.resolve(RANK_METHOD_HYBRID))?.method).toBe(RANK_METHOD_HYBRID);
  });

  it('degrades unknown and hybrid-without-semantic to keyword (never a crash)', async () => {
    const keyword = fake('keyword');
    // No semantic layer wired → hybrid is unreachable, resolves to keyword.
    const noSemantic = new RetrieverFactory(keyword, noopLogger);
    expect((await noSemantic.resolve(RANK_METHOD_HYBRID))?.method).toBe(RANK_METHOD_KEYWORD);

    // Unknown method also degrades to keyword.
    const factory = new RetrieverFactory(keyword, noopLogger);
    expect((await factory.resolve('rag_fusion'))?.method).toBe(RANK_METHOD_KEYWORD);
  });

  it('selects rag_fusion when all dependencies are wired', async () => {
    const keyword = fake('keyword');
    const semantic = fake('semantic');
    const rewriter = { rewrite: async (q: string) => [q] };
    const factory = new RetrieverFactory(
      keyword,
      noopLogger,
      undefined,
      semantic,
      rewriter as never,
    );
    expect((await factory.resolve(RANK_METHOD_RAG_FUSION))?.method).toBe(RANK_METHOD_RAG_FUSION);
  });

  it('EnvRankDefaultProvider reads DEFAULT_RANK_METHOD from env', async () => {
    const orig = process.env.DEFAULT_RANK_METHOD;
    try {
      process.env.DEFAULT_RANK_METHOD = RANK_METHOD_HYBRID;
      const resolver = new EnvRankDefaultProvider();
      expect(await resolver.resolveDefaultRankMethod()).toBe(RANK_METHOD_HYBRID);

      process.env.DEFAULT_RANK_METHOD = RANK_METHOD_RAG_FUSION;
      expect(await resolver.resolveDefaultRankMethod()).toBe(RANK_METHOD_RAG_FUSION);

      process.env.DEFAULT_RANK_METHOD = 'unknown';
      expect(await resolver.resolveDefaultRankMethod()).toBe(RANK_METHOD_KEYWORD);
    } finally {
      if (orig === undefined) delete process.env.DEFAULT_RANK_METHOD;
      else process.env.DEFAULT_RANK_METHOD = orig;
    }
  });
});
