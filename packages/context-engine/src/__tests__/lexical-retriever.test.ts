import { describe, expect, it } from 'vitest';

import { LexicalRetriever } from '../retrieval/lexical-retriever.js';
import type { RetrievalQuery } from '../retrieval/retriever.js';
import { RANK_METHOD_KEYWORD } from '../retrieval/retriever-factory.js';

const CORPUS: RetrievalQuery = {
  text: 'payment service refund',
  targetFiles: [],
  documents: [
    { sourceId: 'src/PaymentService.ts', content: 'payment service refund processing' },
    { sourceId: 'src/AuthService.ts', content: 'authentication session token' },
    { sourceId: 'src/RefundUtil.ts', content: 'refund amount currency' },
  ],
};

describe('LexicalRetriever', () => {
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

  it('returns [] for an empty corpus', async () => {
    const retriever = new LexicalRetriever();
    const result = await retriever.retrieve({ text: 'hello', targetFiles: [], documents: [] });
    expect(result).toEqual([]);
  });
});
