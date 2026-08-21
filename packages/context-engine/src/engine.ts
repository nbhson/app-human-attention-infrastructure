/**
 * ContextEngine (day-20 §2.5) — scan → rank → trim → persist.
 *
 * `resolveContext` runs the Phase-1 pipeline end to end: collect eligible files
 * under the root, rank them against task keywords + target files, trim to the
 * token budget, and persist the snapshot into `contexts` for provenance. Day 21
 * folds freshness on top of the stored per-source `content_hash`.
 */

import { contexts } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createContextSnapshot, newContextID } from '@harness/domain';
import type { ContextSnapshot } from '@harness/domain';

import { FileCollector } from './collect.js';
import { KeywordDependencyRanker } from './rank.js';
import type { Ranker } from './rank.js';
import { tokenize } from './tokenizer.js';
import { applyBudget, DEFAULT_CONTEXT_POLICY, RANK_METHOD } from './trim.js';
import { ApproxTokenizer } from './types.js';
import type { ContextRequest, Tokenizer } from './types.js';

export class ContextEngine {
  constructor(
    private readonly db: DrizzleDB,
    private readonly collector: FileCollector,
    private readonly ranker: Ranker = new KeywordDependencyRanker(),
    private readonly tokenizer: Tokenizer = new ApproxTokenizer(),
  ) {}

  /** Resolve, budget, and persist the context for one task (day-20 §2.5). */
  async resolveContext(request: ContextRequest): Promise<ContextSnapshot> {
    const taskKeywords = tokenize(`${request.taskDescription} ${request.requirements}`);
    const files = await this.collector.collect();
    const ranked = this.ranker.rank(taskKeywords, request.targetFiles, files);
    const { sources, totalTokens } = applyBudget(ranked, {
      targetFiles: request.targetFiles,
      tokenizer: this.tokenizer,
      maxTokens: request.maxTokens,
      policy: request.policy ?? DEFAULT_CONTEXT_POLICY,
    });

    const snapshot = createContextSnapshot({
      id: newContextID(),
      taskId: request.taskId,
      sources,
      totalTokens,
      rankMethod: RANK_METHOD,
      metadata: {
        tokenizer: 'approx-4',
        targetFiles: [...request.targetFiles],
      },
    });

    await this.db.insert(contexts).values({
      id: snapshot.id,
      task_id: snapshot.taskId,
      sources: snapshot.sources,
      total_tokens: snapshot.totalTokens,
      rank_method: snapshot.rankMethod,
      metadata: snapshot.metadata,
    });

    return snapshot;
  }
}
