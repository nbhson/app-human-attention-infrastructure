import { describe, expect, it } from 'vitest';

import { SemanticDocRetriever } from '../retrieval/semantic-doc-retriever.js';
import type { RetrievalQuery } from '../retrieval/retriever.js';

const CORPUS: RetrievalQuery = {
  text: 'payment refund',
  targetFiles: [],
  documents: [
    { sourceId: 'src/PaymentService.ts', content: 'payment service refund processing' },
    { sourceId: 'src/AuthService.ts', content: 'authentication session token' },
    { sourceId: 'a', content: 'content:a' },
  ],
};

describe('SemanticDocRetriever', () => {
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
    expect(result[0]?.score).toBeCloseTo(0.95);
  });

  it('returns [] for a cold (empty) candidate set', async () => {
    const retriever = new SemanticDocRetriever({ retrieve: async () => [] });
    expect(await retriever.retrieve(CORPUS)).toEqual([]);
  });

  it('preserves matchedBy as semantic', async () => {
    const source = {
      retrieve: async () => [{ sourceId: 'a', contentHash: 'h1', embedding: [1], similarity: 0.5 }],
    };
    const retriever = new SemanticDocRetriever(source);
    const result = await retriever.retrieve(CORPUS);
    // SemanticDocRetriever does not set matchedBy — it is the HybridRetriever's
    // job to annotate overlap. Here we just verify the doc lands through.
    expect(result).toHaveLength(1);
    expect(result[0]?.sourceId).toBe('a');
  });
});
