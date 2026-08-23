/**
 * `dependencyProximity` (day-27 §2.3, §2.4) — the re-rank dependency signal as a
 * graph-distance over the Day-14 dependency graph.
 *
 * The context-engine re-ranker needs a single number `[0,1]` for "how close is
 * `candidate` to one of the changed files". This is that number, computed from
 * the same reverse-adjacency the `affectedTests` walk uses: changed files are
 * distance 0, files that directly import one are distance 1, and so on.
 *
 * Tiers (matching the day-20 path-proximity style, but graph-based):
 *
 * | relationship                        | value |
 * |-------------------------------------|-------|
 * | candidate is a changed file itself  | 1.0   |
 * | directly imports a changed file     | 0.6   |
 * | transitively imports (distance ≥ 2) | 0.3   |
 * | indexed but unrelated               | 0.1   |
 * | no graph entry (cold)               | null  |
 *
 * `null` is the *cold* sentinel, not a score: the re-ranker maps it to a neutral
 * 0.5 (day-27 §2.4) so a missing graph entry never demotes a good RRF match. This
 * is a soft re-rank signal, not a correctness gate — a graph gap contributes no
 * dependency boost, but the fusion + other signals still carry the candidate.
 */

import type { DependencyGraph } from './graph.js';

/** Candidate is itself a changed file. */
export const DEP_TARGET = 1.0;
/** Direct importer of a changed file (distance 1). */
export const DEP_DIRECT = 0.6;
/** Transitive importer (distance ≥ 2). */
export const DEP_TRANSITIVE = 0.3;
/** Indexed, but unreachable from every changed file. */
export const DEP_UNRELATED = 0.1;

export function dependencyProximity(
  changedFiles: readonly string[],
  candidate: string,
  graph: DependencyGraph,
): number | null {
  if (!graph.files.has(candidate)) {
    return null; // cold: no graph entry for this candidate (re-ranker → neutral).
  }
  if (changedFiles.includes(candidate)) {
    return DEP_TARGET;
  }

  // BFS over reverse edges from the indexed changed files. A changed file the
  // graph never indexed is a gap (contributes no dependents), not an error —
  // this is a soft signal, and dropping the boost is the honest fallback.
  const changedSet = new Set(changedFiles.filter((file) => graph.files.has(file)));
  if (changedSet.size === 0) {
    return DEP_UNRELATED;
  }

  const seen = new Set(changedSet);
  let frontier = [...changedSet];
  let distance = 0;

  while (frontier.length > 0) {
    distance += 1;
    const next: string[] = [];
    for (const file of frontier) {
      for (const importer of graph.reverse.get(file) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        if (importer === candidate) {
          return distance === 1 ? DEP_DIRECT : DEP_TRANSITIVE;
        }
        next.push(importer);
      }
    }
    frontier = next;
  }

  return DEP_UNRELATED;
}
