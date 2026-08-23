/**
 * `code-index` dependency graph (day-14 §3.3) — assemble indexed files into the
 * forward + reverse adjacency that `affectedTests` traverses.
 *
 * The graph is a pure in-memory structure over the indexer's output; persistence
 * to the `code_index_symbols` / `code_index_deps` tables is the `@harness/db`
 * concern, and the `IndexedSymbol`/`IndexedEdge` shapes are the row payloads a
 * later ingestion writes. Only *local, resolvable* edges live here — a bare
 * package or dynamic import is not an edge, it is a `complete: false` on the
 * owning file (surfaced via {@link DependencyGraph.incompleteFiles}).
 */

import type { IndexedEdge, IndexedFile } from './indexer.js';

/** A local, resolvable dependency edge (from-file lives in the edges map key). */
export interface Edge {
  readonly to: string;
  /** {@link import('./indexer.js').DependencyKind}. */
  readonly kind: IndexedEdge['kind'];
}

/** Reverse + forward adjacency over the indexed file set. */
export interface DependencyGraph {
  /** Every indexed file (the graph's vertex set). */
  readonly files: ReadonlySet<string>;
  /** Forward edges: `from → [{ to, kind }, …]` (local targets only). */
  readonly edges: ReadonlyMap<string, readonly Edge[]>;
  /** Reverse edges: `to → [importingFile, …]` — the affected-set back-edge index. */
  readonly reverse: ReadonlyMap<string, readonly string[]>;
  /** Files whose index is incomplete (dynamic import / bare specifier / gap). */
  readonly incompleteFiles: ReadonlySet<string>;
}

/** Build the forward + reverse adjacency from a set of indexed files. */
export function buildGraph(indexed: ReadonlyMap<string, IndexedFile>): DependencyGraph {
  const edges = new Map<string, Edge[]>();
  const incompleteFiles = new Set<string>();

  for (const [file, indexedFile] of indexed) {
    edges.set(
      file,
      indexedFile.edges.map((edge) => ({ to: edge.to, kind: edge.kind })),
    );
    if (!indexedFile.complete) {
      incompleteFiles.add(file);
    }
  }

  const reverse = new Map<string, string[]>();
  for (const [from, out] of edges) {
    // Deduplicate importers (a file may be imported more than once via distinct
    // specifiers from the same module, but one reverse edge is enough for BFS).
    const seen = new Set<string>();
    for (const edge of out) {
      if (seen.has(edge.to) || !indexed.has(edge.to)) continue;
      seen.add(edge.to);
      const importers = reverse.get(edge.to) ?? [];
      importers.push(from);
      reverse.set(edge.to, importers);
    }
  }

  return { files: new Set(indexed.keys()), edges, reverse, incompleteFiles };
}
