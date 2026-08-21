/**
 * Ranking (day-20 §2.3) — the Phase-1 relevance formula.
 *
 * `relevance_score = 0.7 · keyword_overlap + 0.3 · dependency_proximity`. The
 * semantic/recency/history terms are fixed at 0 until Phase 3; the {@link Ranker}
 * interface is the seam that lets Phase-3 terms activate without touching callers
 * (day-20 §6).
 */

import { dirname } from 'node:path';

import type { CollectedFile } from './collect.js';
import { tokenize } from './tokenizer.js';

export interface RankedFile {
  readonly sourceId: string;
  readonly content: string;
  readonly relevanceScore: number;
}

/** Ranker seam (day-20 §6): Phase-3 terms arrive here, not in callers. */
export interface Ranker {
  rank(
    taskKeywords: ReadonlySet<string>,
    targetFiles: readonly string[],
    files: readonly CollectedFile[],
  ): RankedFile[];
}

/**
 * Fraction of task keywords that appear in `source` (path or content). A
 * deterministic Jaccard-lite overlap: hits / task-keyword count. Returns `0`
 * when the task contributes no keywords.
 */
export function keywordOverlap(taskKeywords: ReadonlySet<string>, source: string): number {
  if (taskKeywords.size === 0) return 0;
  const sourceTokens = tokenize(source);
  let hits = 0;
  for (const keyword of taskKeywords) {
    if (sourceTokens.has(keyword)) hits += 1;
  }
  return hits / taskKeywords.size;
}

/**
 * Path centrality of `path` relative to the task's target files. A target is 1.0;
 * a sibling (same directory) is 0.6; everything else is 0.1. Import-graph
 * proximity (`importsOf`) is Phase-3 and falls back to 0.1 today.
 */
export function dependencyProximity(path: string, targetFiles: readonly string[]): number {
  if (targetFiles.includes(path)) return 1.0;
  if (targetFiles.some((target) => dirname(target) === dirname(path))) return 0.6;
  return 0.1;
}

/** The Phase-1 relevance formula (day-20 §2.3). Weights are 0.7 / 0.3. */
export function relevanceScore(keywordOverlapScore: number, dependencyScore: number): number {
  return 0.7 * keywordOverlapScore + 0.3 * dependencyScore;
}

/** The Phase-1 ranker: keyword + dependency proximity, sorted best-first. */
export class KeywordDependencyRanker implements Ranker {
  rank(
    taskKeywords: ReadonlySet<string>,
    targetFiles: readonly string[],
    files: readonly CollectedFile[],
  ): RankedFile[] {
    return files
      .map((file) => {
        const keywordScore = keywordOverlap(taskKeywords, `${file.sourceId} ${file.content}`);
        const dependencyScore = dependencyProximity(file.sourceId, targetFiles);
        return {
          sourceId: file.sourceId,
          content: file.content,
          relevanceScore: relevanceScore(keywordScore, dependencyScore),
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
}
