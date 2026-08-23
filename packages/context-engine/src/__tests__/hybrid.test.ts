import { describe, expect, it } from 'vitest';

import { HybridRetriever } from '../retrieval/hybrid-retriever.js';
import { LexicalRetriever } from '../retrieval/lexical-retriever.js';
import {
  RetrieverFactory,
  RANK_METHOD_HYBRID,
  RANK_METHOD_KEYWORD,
} from '../retrieval/retriever-factory.js';
import type { RetrievedDoc, Retriever, RetrievalQuery } from '../retrieval/retriever.js';
import { SemanticDocRetriever } from '../retrieval/semantic-doc-retriever.js';
import { reciprocalRankFusion, RRF_K } from '../retrieval/rrf.js';

/** A corpus of three files with distinct, overlapping vocabularies. */
const CORPUS: RetrievalQuery = {
  text: 'payment service refund',
  targetFiles: [],
  documents: [
    { sourceId: 'src/PaymentService.ts', content: 'payment service refund processing' },
    { sourceId: 'src/AuthService.ts', content: 'authentication session token' },
    { sourceId: 'src/RefundUtil.ts', content: 'refund amount currency' },
  ],
};

/** A fake retriever that returns fixed docs at a controllable latency. */
function fake(method: string, docs: RetrievedDoc[]): Retriever {
  return { method, retrieve: async () => docs };
}

function doc(
  sourceId: string,
  score: number,
  matchedBy: RetrievedDoc['matchedBy'] = 'lexical',
): RetrievedDoc {
  return { sourceId, content: `content:${sourceId}`, score, matchedBy };
}

describe('reciprocalRankFusion (day-26 §2.2)', () => {
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
});

describe('HybridRetriever (day-26 §2.1)', () => {
  it('fuses lexical + semantic and marks overlap as both', async () => {
    const lexical = fake('keyword', [doc('a', 1), doc('b', 0.5)]);
    const semantic = fake('semantic', [doc('b', 0.9), doc('c', 0.8)]);
    const hybrid = new HybridRetriever(lexical, semantic);

    const result = await hybrid.retrieve(CORPUS);
    // b → rank2 in lexical + rank1 in semantic (1/62 + 1/61) > a (1/61) > c (1/62).
    expect(result.map((d) => d.sourceId)).toEqual(['b', 'a', 'c']);
    expect(result[0]?.matchedBy).toBe('both');
    expect(result[1]?.matchedBy).toBe('lexical');
    expect(result[2]?.matchedBy).toBe('semantic');
  });

  it('falls back to lexical-only when the semantic layer is cold (empty)', async () => {
    const lexical = fake('keyword', [doc('a', 1), doc('b', 0.5)]);
    const semantic = fake('semantic', []);
    const hybrid = new HybridRetriever(lexical, semantic);

    const result = await hybrid.retrieve(CORPUS);
    // Nothing dropped, nothing marked semantic/both — a missing vector never
    // zeroes out a real lexical match (day-26 §2.4).
    expect(result.map((d) => d.sourceId)).toEqual(['a', 'b']);
    expect(result.every((d) => d.matchedBy === 'lexical')).toBe(true);
  });

  it('runs both layers concurrently — latency is the slower, not the sum', async () => {
    const calls: string[] = [];
    let releaseSemantic: (docs: RetrievedDoc[]) => void = () => {};
    const semanticGate = new Promise<RetrievedDoc[]>((resolve) => {
      releaseSemantic = resolve;
    });

    const lexical: Retriever = {
      method: 'keyword',
      retrieve: async () => {
        calls.push('lexical-start');
        return [doc('a', 1)];
      },
    };
    const semantic: Retriever = {
      method: 'semantic',
      retrieve: async () => {
        calls.push('semantic-start');
        return semanticGate;
      },
    };

    const hybrid = new HybridRetriever(lexical, semantic);
    let done = false;
    const pending = hybrid.retrieve(CORPUS).then(() => {
      done = true;
      return undefined;
    });

    // Let the microtask queue drain: both layers must have started.
    await Promise.resolve();
    expect(calls).toContain('lexical-start');
    expect(calls).toContain('semantic-start');
    expect(done).toBe(false); // blocked on the slower layer

    releaseSemantic([doc('b', 0.9)]);
    await pending;
    expect(done).toBe(true);
  });
});

describe('LexicalRetriever (day-26 §3.1)', () => {
  it('ranks the corpus by keyword + dependency behind the Retriever seam', async () => {
    const retriever = new LexicalRetriever();
    const result = await retriever.retrieve(CORPUS);

    // PaymentService matches 'payment service refund' most; RefundUtil next.
    expect(result[0]?.sourceId).toBe('src/PaymentService.ts');
    expect(result[0]?.matchedBy).toBe('lexical');
    expect(result[0]?.score).toBeGreaterThan(result.at(-1)?.score ?? 0);
  });

  it('reports method "keyword"', () => {
    expect(new LexicalRetriever().method).toBe(RANK_METHOD_KEYWORD);
  });
});

describe('SemanticDocRetriever (day-26 §2.4)', () => {
  it('joins candidates back to corpus content and drops missing sourceIds', async () => {
    const source = {
      retrieve: async () => [
        { sourceId: 'src/PaymentService.ts', contentHash: 'h1', embedding: [1], similarity: 0.95 },
        { sourceId: 'src/Gone.ts', contentHash: 'h2', embedding: [1], similarity: 0.8 },
      ],
    };
    const retriever = new SemanticDocRetriever(source);
    const result = await retriever.retrieve(CORPUS);

    expect(result.map((d) => d.sourceId)).toEqual(['src/PaymentService.ts']);
    expect(result[0]?.content).toBe('payment service refund processing');
    expect(result[0]?.matchedBy).toBe('semantic');
    expect(result[0]?.score).toBeCloseTo(0.95);
  });

  it('returns [] for a cold (empty) candidate set', async () => {
    const retriever = new SemanticDocRetriever({ retrieve: async () => [] });
    expect(await retriever.retrieve(CORPUS)).toEqual([]);
  });
});

describe('RetrieverFactory (day-26 §2.3)', () => {
  it('defaults to keyword and selects hybrid only when named', () => {
    const keyword = fake('keyword', []);
    const semantic = fake('semantic', []);
    const factory = new RetrieverFactory(keyword, semantic);

    expect(factory.resolve(undefined)?.method).toBe(RANK_METHOD_KEYWORD);
    expect(factory.resolve('keyword')?.method).toBe(RANK_METHOD_KEYWORD);
    expect(factory.resolve(RANK_METHOD_HYBRID)?.method).toBe(RANK_METHOD_HYBRID);
  });

  it('degrades unknown and hybrid-without-semantic to keyword (never a crash)', () => {
    const keyword = fake('keyword', []);
    // No semantic layer wired → hybrid is unreachable, resolves to keyword.
    const noSemantic = new RetrieverFactory(keyword);
    expect(noSemantic.resolve(RANK_METHOD_HYBRID)?.method).toBe(RANK_METHOD_KEYWORD);

    const factory = new RetrieverFactory(keyword);
    expect(factory.resolve('rag_fusion')?.method).toBe(RANK_METHOD_KEYWORD);
  });
});
