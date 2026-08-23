/**
 * `affectedTests` (day-14 §3.4) — the transitive affected-test computation.
 *
 * Seed with the changed files, walk the {@link DependencyGraph.reverse} edges to
 * every file that (transitively) imports them, and return the test files in that
 * closure. The safety net is the {@link AffectedTestsResult.complete} flag:
 * whenever the walk passes through an *incomplete* file — or a changed file was
 * never indexed at all — the result is `complete: false`, and the caller must
 * fall back to the full suite (§2.3). A targeted run that cannot prove a skipped
 * test irrelevant is a miss; this function refuses to make one.
 */

import type { DependencyGraph } from './graph.js';
import { isTestFile } from './indexer.js';

/** The outcome of an affected-test query (§2.2). */
export interface AffectedTestsResult {
  /** Test files transitively affected by the change (relative paths). */
  readonly tests: readonly string[];
  /** `false` when the walk hit a graph gap — the caller must run the full suite. */
  readonly complete: boolean;
}

/**
 * Compute the transitively affected test set. `complete` is `false` when any
 * reachable file carries an unresolved import (a dynamic `import(variable)`, a
 * bare/aliased package, or a code specifier with no local target), or when a
 * changed file was never indexed — either way the graph cannot prove the
 * remaining tests irrelevant.
 */
export function affectedTests(
  changedFiles: readonly string[],
  graph: DependencyGraph,
): AffectedTestsResult {
  let complete = true;
  const seen = new Set<string>();
  const queue: string[] = [];

  for (const file of changedFiles) {
    queue.push(file);
    // A changed file outside the index is a graph gap by definition.
    if (!graph.files.has(file)) {
      complete = false;
    }
  }

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    if (graph.incompleteFiles.has(file)) {
      complete = false;
    }
    for (const importer of graph.reverse.get(file) ?? []) {
      queue.push(importer);
    }
  }

  const tests = [...seen].filter(isTestFile);
  return { tests, complete };
}
