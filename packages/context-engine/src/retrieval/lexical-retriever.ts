/**
 * Lexical retriever (day-26 §2.1, §3.1) — the Phase-2 keyword ranker behind the
 * {@link Retriever} seam.
 *
 * This is a thin adapter over {@link KeywordDependencyRanker} (day-20 §2.3): it
 * tokenizes the query text into the ranker's keyword set and delegates to the
 * existing `0.7 · keyword_overlap + 0.3 · dependency_proximity` formula, wrapping
 * the sync result into `RetrievedDoc[]` so the hybrid composer can run it
 * concurrently with the semantic layer.
 *
 * Its `method` is the canonical `'keyword'` — the day-26 default that stays the
 * served ranking until Day 29's measured cutover.
 */

import type { CollectedFile } from '../collect.js';
import { KeywordDependencyRanker } from '../rank.js';
import { tokenize } from '../tokenizer.js';
import type { RetrievedDoc, RetrievalQuery, Retriever } from './retriever.js';

export class LexicalRetriever implements Retriever {
  readonly method = 'keyword';

  private readonly ranker = new KeywordDependencyRanker();

  async retrieve(query: RetrievalQuery): Promise<RetrievedDoc[]> {
    const keywords = tokenize(query.text);
    const files: CollectedFile[] = query.documents.map((document) => ({
      sourceId: document.sourceId,
      content: document.content,
    }));

    return this.ranker.rank(keywords, query.targetFiles, files).map((file) => ({
      sourceId: file.sourceId,
      content: file.content,
      score: file.relevanceScore,
      matchedBy: 'lexical',
    }));
  }
}
