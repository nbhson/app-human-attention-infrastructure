import { describe, expect, it } from 'vitest';

import { HybridRetriever } from '../retrieval/hybrid-retriever.js';
import type { RetrievedDoc, Retriever, RetrievalQuery } from '../retrieval/retriever.js';

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

const CORPUS: RetrievalQuery = {
  text: 'payment service refund',
  targetFiles: [],
  documents: [
    { sourceId: 'src/PaymentService.ts', content: 'payment service refund processing' },
    { sourceId: 'src/AuthService.ts', content: 'authentication session token' },
    { sourceId: 'src/RefundUtil.ts', content: 'refund amount currency' },
  ],
};

describe('HybridRetriever', () => {
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

  it('returns [] when both layers are cold', async () => {
    const lexical = fake('keyword', []);
    const semantic = fake('semantic', []);
    const hybrid = new HybridRetriever(lexical, semantic);

    const result = await hybrid.retrieve(CORPUS);
    expect(result).toEqual([]);
  });

  it('semantic-only works when lexical is empty', async () => {
    const lexical = fake('keyword', []);
    const semantic = fake('semantic', [doc('x', 0.9), doc('y', 0.7)]);
    const hybrid = new HybridRetriever(lexical, semantic);

    const result = await hybrid.retrieve(CORPUS);
    expect(result.map((d) => d.sourceId)).toEqual(['x', 'y']);
    expect(result.every((d) => d.matchedBy === 'semantic')).toBe(true);
  });

  it('prefers lexical content when the same sourceId appears in both layers', async () => {
    const lexical = fake('keyword', [doc('a', 1, 'lexical')]);
    const semantic = fake('semantic', [doc('a', 0.9, 'semantic')]);
    const hybrid = new HybridRetriever(lexical, semantic);

    const result = await hybrid.retrieve(CORPUS);
    // Both layers returned 'a'; content should be from lexical (set last in merge).
    expect(result[0]?.content).toBe('content:a');
    expect(result[0]?.matchedBy).toBe('both');
  });
});
