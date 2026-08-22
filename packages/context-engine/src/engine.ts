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
import {
  ContextSourceType,
  createContextSnapshot,
  createContextSource,
  newContextID,
} from '@harness/domain';
import type { ContextSnapshot } from '@harness/domain';
import type { Embedder } from '@harness/embeddings';

import { FileCollector } from './collect.js';
import { checkFreshness, sha256 } from './freshness.js';
import type { FreshnessResult } from './freshness.js';
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
    // Reserved for the Day-18 semantic retriever behind the Ranker seam. The
    // default keyword path (`resolveContext` / `resolveFresh`) never reads it —
    // that is exactly the shadow-then-default guarantee the shadow-negative test
    // (day-16 §3.5) asserts.
    private readonly embedder?: Embedder,
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
        taskDescription: request.taskDescription,
        requirements: request.requirements,
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

  /**
   * STALE re-resolve (day-21 §2.1): if `previous` has gone stale, re-collect and
   * re-rank *only* the changed source files and patch them in place, leaving every
   * other source (and its budget) untouched. Vanished sources are kept but stay
   * flagged; each refresh appends a `freshness_events` entry for provenance.
   */
  async resolveFresh(
    request: ContextRequest,
    previous: ContextSnapshot,
  ): Promise<{ snapshot: ContextSnapshot; freshness: FreshnessResult }> {
    const freshness = await checkFreshness(previous, this.collector.root);
    if (freshness.freshness === 'FRESH') {
      return { snapshot: previous, freshness };
    }

    const staleSet = new Set(freshness.staleSources);
    const reCollected = await this.collector.collectPaths([...staleSet]);
    const taskKeywords = tokenize(`${request.taskDescription} ${request.requirements}`);
    const reRanked = this.ranker.rank(taskKeywords, request.targetFiles, reCollected);
    const byId = new Map(reRanked.map((file) => [file.sourceId, file]));

    const patchedSources = previous.sources.map((source) => {
      const fresh = byId.get(source.sourceId);
      if (!fresh) {
        // Vanished or unreadable after it was flagged stale — keep the old source
        // so it is never mistaken for fresh.
        return source;
      }
      return createContextSource({
        type: ContextSourceType.File,
        sourceId: source.sourceId,
        relevanceScore: fresh.relevanceScore,
        content: fresh.content,
        tokenCount: this.tokenizer.count(fresh.content),
        contentHash: sha256(fresh.content),
        metadata: { ...source.metadata, refreshed: true },
      });
    });

    const previousEvents = Array.isArray(previous.metadata.freshness_events)
      ? previous.metadata.freshness_events
      : [];
    const snapshot = createContextSnapshot({
      id: previous.id,
      taskId: previous.taskId,
      sources: patchedSources,
      totalTokens: patchedSources.reduce((sum, source) => sum + source.tokenCount, 0),
      rankMethod: previous.rankMethod,
      metadata: {
        ...previous.metadata,
        freshness_events: [
          ...previousEvents,
          { at: new Date().toISOString(), stale: freshness.staleSources },
        ],
      },
    });

    return { snapshot, freshness };
  }
}
