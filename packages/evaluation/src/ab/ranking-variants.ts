/**
 * Day-29 §2.1 — the two head-to-head context-rankers behind one seam.
 *
 * A {@link ContextRanker} is a *pure function* from a ranking corpus to a
 * best-first ordering of source files. The only thing that differs between the two
 * arms is that function (day-29 §6 "vary one thing"): both rank the same corpus,
 * with the same tokenizer, over the same candidate files, and neither may drop a
 * target file.
 *
 * Because `@harness/evaluation` must not import an engine (boundary R9) or the
 * embedder package (R10), all rankers are **self-contained shadow copies** — the
 * keyword ranker mirrors `context-engine/rank.ts`; the semantic ranker is a
 * deterministic vector-space stand-in (term-frequency cosine similarity) for the
 * production embedder (day-18); and the hybrid ranker mirrors the Day-26/27
 * `HybridRetriever → ReRanker` path by fusing those two layers with a shadow
 * reciprocal-rank-fusion and re-ranking with a dependency signal. The harness
 * validates comparison *plumbing* here, not absolute ranker quality: that stays the
 * engine's concern.
 */

import type { AgentRun } from '@harness/domain';

import {
  dependencyProximity,
  deriveCorpus,
  keywordOverlap,
  weightedRelevance,
  DEFAULT_RANK_WEIGHTS,
} from '../harness/variant.js';
import type { CandidateFile } from '../harness/variant.js';

export type ContextRankerKind = 'keyword' | 'semantic' | 'hybrid';

/** One ranked source: its id and its relevance score under the ranking function. */
export interface RankedSource {
  readonly sourceId: string;
  readonly relevanceScore: number;
}

/** A ranking problem: raw task text + candidate files + the known target files. */
export interface RankingCorpus {
  /** Raw task text (concatenated THOUGHT contents, un-tokenized). */
  readonly query: string;
  readonly targetFiles: readonly string[];
  readonly candidateFiles: readonly CandidateFile[];
}

/** The context-ranking seam (day-29 §2.1). Pure: same corpus ⇒ same order. */
export interface ContextRanker {
  readonly kind: ContextRankerKind;
  rank(corpus: RankingCorpus): readonly RankedSource[];
}

/** Lowercase, split on non-alphanumerics, dedup — identical for both arms. */
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

/**
 * Build the ranking corpus: candidates/targets from the shadow {@link deriveCorpus},
 * plus the raw query text the semantic arm needs (the tokenized `taskKeywords`
 * alone lose word order and content-only terms).
 */
export function deriveRankingCorpus(trajectory: AgentRun): RankingCorpus {
  const corpus = deriveCorpus(trajectory);
  const query = trajectory.steps
    .filter((step) => step.type === 'THOUGHT')
    .map((step) => step.content)
    .join(' ');
  return { query, targetFiles: corpus.targetFiles, candidateFiles: corpus.candidateFiles };
}

/** Bottom-of-rank marker: no ranking signal, but the target may not be dropped. */
const NO_SIGNAL = -1;

/** Append any target a ranker had no signal for, then re-sort best-first. */
function ensureTargetsPresent(
  ranked: ReadonlyArray<RankedSource>,
  corpus: RankingCorpus,
): RankedSource[] {
  const present = new Set(ranked.map((item) => item.sourceId));
  const result = [...ranked];
  for (const target of corpus.targetFiles) {
    if (!present.has(target)) result.push({ sourceId: target, relevanceScore: NO_SIGNAL });
  }
  return result.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/** Arm A (control): the current keyword + dependency-proximity formula (0.7 / 0.3). */
export const keywordRanker: ContextRanker = {
  kind: 'keyword',
  rank(corpus) {
    const keywords = new Set(tokenize(corpus.query));
    const ranked = corpus.candidateFiles.map((file) => ({
      sourceId: file.sourceId,
      relevanceScore: weightedRelevance(
        keywordOverlap(keywords, `${file.sourceId} ${file.content}`),
        dependencyProximity(file.sourceId, corpus.targetFiles),
        DEFAULT_RANK_WEIGHTS,
      ),
    }));
    return ensureTargetsPresent(ranked, corpus);
  },
};

/** Term-frequency counts over the shared tokenizer. */
function termFrequency(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of tokenize(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

/** Cosine similarity over the vocabulary union of two term-frequency vectors. */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const term of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(term) ?? 0;
    const y = b.get(term) ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Arm B (challenger): vector-space similarity of each file to the raw task text.
 * Uses the same tokenizer as the keyword arm, so the two arms differ only in the
 * *formula* (geometry vs hit-ratio + path centrality), never in the input.
 */
export const semanticRanker: ContextRanker = {
  kind: 'semantic',
  rank(corpus) {
    const query = termFrequency(corpus.query);
    const ranked = corpus.candidateFiles.map((file) => ({
      sourceId: file.sourceId,
      relevanceScore: cosineSimilarity(query, termFrequency(`${file.sourceId} ${file.content}`)),
    }));
    return ensureTargetsPresent(ranked, corpus);
  },
};

/** The RRF damping constant — the shadow copy of `context-engine/rrf.ts` (§2.2). */
const SHADOW_RRF_K = 60;

/** One fused source: its id and its reciprocal-rank score (sorted best-first). */
interface FusedSource {
  readonly sourceId: string;
  readonly score: number;
}

/**
 * Shadow reciprocal-rank fusion — the rank-only blend mirrored from
 * `context-engine/rrf.ts` (day-26 §2.2). `score(d) = Σ 1/(k + rank_i(d))` over the
 * layers that listed `d`. Only *ranks* feed the score, so the keyword overlap and
 * the cosine similarity — which live on incomparable scales — never meet directly.
 * Ties break by sourceId ascending for full determinism.
 */
function reciprocalRankFusion(
  layers: readonly (readonly string[])[],
  k = SHADOW_RRF_K,
): FusedSource[] {
  const scores = new Map<string, number>();
  for (const layer of layers) {
    const seen = new Set<string>();
    let rank = 0;
    for (const sourceId of layer) {
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      rank += 1;
      scores.set(sourceId, (scores.get(sourceId) ?? 0) + 1 / (k + rank));
    }
  }
  return [...scores.entries()]
    .map(([sourceId, score]) => ({ sourceId, score }))
    .sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId));
}

/** The re-rank blend weights, mirrored from `context-engine/ranking/signals.ts`. */
const SHADOW_FUSION_WEIGHT = 0.5;
const SHADOW_DEPENDENCY_WEIGHT = 0.3;

/**
 * Arm B (challenger): the Day-26/27 hybrid — lexical ⊕ semantic, fused by RRF,
 * then re-ranked. Mirrors the engine's `HybridRetriever → ReRanker` path:
 *
 * 1. both shadow layers rank the corpus independently (each already keeps every
 *    target, so the fused union inherits target-preservation);
 * 2. `reciprocalRankFusion` blends their two orders by rank;
 * 3. the re-rank blend `0.5·fusion_norm + 0.3·dependency` re-orders the union.
 *
 * The re-rank's recency and usage signals are absent in the shadow (no mtime or
 * retrieval counters on a replayed trajectory), so each contributes the neutral
 * `0.5` — a *constant* added to every candidate that drops out of the ordering.
 * The dependency signal is the shadow path-centrality stand-in (`1.0` target,
 * `0.6` same-dir, `0.1` elsewhere), never `null`, so the engine's cold-graph
 * neutral branch is inert here.
 */
export const hybridRanker: ContextRanker = {
  kind: 'hybrid',
  rank(corpus) {
    const keywordOrder = keywordRanker.rank(corpus).map((source) => source.sourceId);
    const semanticOrder = semanticRanker.rank(corpus).map((source) => source.sourceId);
    const fused = reciprocalRankFusion([keywordOrder, semanticOrder]);
    const maxRrf = fused.reduce((max, source) => Math.max(max, source.score), 0);

    const ranked = fused.map((source) => {
      const fusion = maxRrf > 0 ? source.score / maxRrf : 0;
      const dependency = dependencyProximity(source.sourceId, corpus.targetFiles);
      return {
        sourceId: source.sourceId,
        relevanceScore: SHADOW_FUSION_WEIGHT * fusion + SHADOW_DEPENDENCY_WEIGHT * dependency,
      };
    });

    return ranked.sort(
      (a, b) => b.relevanceScore - a.relevanceScore || a.sourceId.localeCompare(b.sourceId),
    );
  },
};

/** The two arms behind the shared seam — control (keyword) then challenger (hybrid). */
export function rankingVariants(): readonly ContextRanker[] {
  return [keywordRanker, hybridRanker];
}
