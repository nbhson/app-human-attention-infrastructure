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
 * embedder package (R10), both rankers are **self-contained shadow copies** — the
 * keyword ranker mirrors `context-engine/rank.ts`, and the semantic ranker is a
 * deterministic vector-space stand-in (term-frequency cosine similarity) for the
 * production embedder the engine runs in shadow (day-18). The harness validates the
 * comparison *plumbing* here, not the embedder's absolute quality: that stays the
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

export type ContextRankerKind = 'keyword' | 'semantic';

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

/** The two arms behind the shared seam — identical except for {@link ContextRanker.rank}. */
export function rankingVariants(): readonly ContextRanker[] {
  return [keywordRanker, semanticRanker];
}
