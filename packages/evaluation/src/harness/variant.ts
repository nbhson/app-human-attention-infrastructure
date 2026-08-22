/**
 * A/B variant model + the shadow keyword ranker (day-09 §2.1, §3.2).
 *
 * A {@link PipelineVariant} is a declared, versioned config bundle — an executable
 * ranking/attention weighting, not an ad-hoc string. The harness constructs an
 * isolated evaluation context per variant and swaps the config *inside the
 * harness*, never on the live DI graph (§2.1).
 *
 * Because `@harness/evaluation` must not import an engine (boundary rule R4), the
 * keyword relevance formula that measures a variant is a **self-contained shadow
 * copy** of the Phase-1 ranker (`context-engine/rank.ts`). It is provisional: Week
 * 4 replaces this path with the real semantic retriever running in shadow. The
 * overlap here is deliberately simple — task keywords are lowercased/deduped word
 * tokens, and `keywordOverlap` is hits ÷ keyword count — enough to prove A vs B
 * end-to-end without pretending to be the production ranker.
 */

import { dirname } from 'node:path';

import type { AgentRun } from '@harness/domain';

import type { ReplayInput } from '../trajectory-replayer.js';

export type ContextRankerKind = 'keyword' | 'semantic';

/** The context-ranker weight tuple. `semantic` is reserved for Week 4 (inert now). */
export interface RankWeights {
  readonly keywordOverlap: number;
  readonly dependencyProximity: number;
  readonly semantic?: number;
}

/** The attention-engine weight tuple (reserved; not exercised in the Day-09 demo). */
export interface AttentionWeights {
  readonly risk: number;
  readonly impact: number;
  readonly novelty: number;
  readonly complexity: number;
  readonly confidence: number;
}

/** A declared, versioned pipeline variant (day-09 §2.1). */
export interface PipelineVariant {
  /** Stable id, e.g. `"baseline-keyword"` or `"semantic-shadow-1536"`. */
  readonly variantId: string;
  readonly description: string;
  readonly contextRanker: ContextRankerKind;
  readonly rankWeights?: RankWeights;
  readonly attentionWeights?: AttentionWeights;
}

/** One side of an experiment: the variant plus the trajectories it runs over. */
export interface VariantConfig {
  readonly name: string;
  readonly variant: PipelineVariant;
  readonly inputs: readonly ReplayInput[];
}

/** A ranking problem the shadow ranker scores: candidate files vs known targets. */
export interface CandidateFile {
  readonly sourceId: string;
  readonly content: string;
}

export interface RankCorpus {
  readonly taskKeywords: readonly string[];
  readonly targetFiles: readonly string[];
  readonly candidateFiles: readonly CandidateFile[];
}

/** The Phase-1 baseline weights (day-09 §3.4). */
export const DEFAULT_RANK_WEIGHTS: RankWeights = { keywordOverlap: 0.7, dependencyProximity: 0.3 };

/** Lowercase, split on non-alphanumerics, dedup. Shadow tokenizer (no stopwords). */
function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 0),
    ),
  ];
}

/** Fraction of `keywords` present in `source` — the shadow copy of rank.ts. */
export function keywordOverlap(keywords: ReadonlySet<string>, source: string): number {
  if (keywords.size === 0) return 0;
  const sourceTokens = new Set(tokenize(source));
  let hits = 0;
  for (const keyword of keywords) {
    if (sourceTokens.has(keyword)) hits += 1;
  }
  return hits / keywords.size;
}

/** Path centrality: target is 1.0, same-dir is 0.6, else 0.1 (rank.ts shadow). */
export function dependencyProximity(path: string, targetFiles: readonly string[]): number {
  if (targetFiles.includes(path)) return 1.0;
  if (targetFiles.some((target) => dirname(target) === dirname(path))) return 0.6;
  return 0.1;
}

/** Weighted relevance, normalized by the sum of the active weights. */
export function weightedRelevance(
  keyword: number,
  dependency: number,
  weights: RankWeights,
): number {
  const kw = weights.keywordOverlap;
  const dep = weights.dependencyProximity;
  const total = kw + dep;
  if (total <= 0) return 0;
  return (kw * keyword + dep * dependency) / total;
}

/**
 * Derive a {@link RankCorpus} from a recorded run: the files it changed are the
 * targets, the files it touched (read/write tool calls) are the candidates, and
 * the concatenated THOUGHT contents are the task keywords.
 */
export function deriveCorpus(trajectory: AgentRun): RankCorpus {
  const targetFiles = trajectory.artifactsChanged;

  const contentByPath = new Map<string, string>();
  for (const step of trajectory.steps) {
    if (step.type !== 'TOOL_CALL') continue;
    const path = step.toolInput['path'];
    const content = step.toolInput['content'];
    if (typeof path !== 'string') continue;
    const existing = contentByPath.get(path);
    if (
      typeof content === 'string' &&
      (existing === undefined || content.length >= existing.length)
    ) {
      contentByPath.set(path, content);
    } else if (existing === undefined) {
      contentByPath.set(path, '');
    }
  }

  const candidateFiles = [...contentByPath.entries()].map(([sourceId, content]) => ({
    sourceId,
    content,
  }));

  const thoughts: string[] = [];
  for (const step of trajectory.steps) {
    if (step.type === 'THOUGHT') thoughts.push(step.content);
  }

  return { taskKeywords: tokenize(thoughts.join(' ')), targetFiles, candidateFiles };
}

/**
 * The predefined comparison metric for a variant over a corpus: **mean target
 * relevance** — the average, over the known target files, of their weighted
 * relevance under the variant's rank weights. Higher is better (a weight tuple
 * that surfaces the real targets is the stronger one). This is the Day-09
 * *proxy* metric; the experiment's `metric` column pins the name before runs.
 */
export function runRankMetric(variant: PipelineVariant, corpus: RankCorpus): number {
  const weights = variant.rankWeights ?? DEFAULT_RANK_WEIGHTS;
  if (corpus.targetFiles.length === 0) return 0;

  const contentByPath = new Map(corpus.candidateFiles.map((file) => [file.sourceId, file.content]));
  const keywords = new Set(corpus.taskKeywords);

  let sum = 0;
  for (const target of corpus.targetFiles) {
    const content = contentByPath.get(target);
    const source = content !== undefined ? `${target} ${content}` : target;
    const keyword = keywordOverlap(keywords, source);
    const dependency = dependencyProximity(target, corpus.targetFiles);
    sum += weightedRelevance(keyword, dependency, weights);
  }
  return sum / corpus.targetFiles.length;
}

/** Score a variant across a set of replayed trajectories (mean over inputs). */
export function metricForVariant(variant: PipelineVariant, inputs: readonly ReplayInput[]): number {
  if (inputs.length === 0) return 0;
  const values = inputs.map((input) => runRankMetric(variant, deriveCorpus(input.trajectory)));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
