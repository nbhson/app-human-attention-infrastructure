# @harness/code-index — Dependency Graph & Affected-Test Closure

Indexes a checkout's symbols + module edges and computes the transitive set of
affected tests for a change — the leaf that makes targeted verification safe.

**Status:** complete (as-built) ·
**Boundary rule:** pure leaf (node built-ins only); consumed by the app host / verification
through a structural seam, never a direct engine import (R4).

---

## Purpose

1. **Index symbols + edges** — `indexFiles` does a conservative lexical scan of
   `import` / `export … from` / `import()` / `require()` and the identifiers each
   file imports/exports.
2. **Build a graph** — `buildGraph` assembles forward + reverse adjacency over the
   indexed files.
3. **Compute the affected closure** — `affectedTests(changed, graph)` walks reverse
   edges from the changed files to every transitively importing test.
4. **Refuse to guess** — any unresolvable edge (bare package, dynamic
   `import(variable)`) marks the owning file `complete: false`, so the caller falls
   back to the full suite.
5. **Feed the re-rank signal** — `dependencyProximity` turns the same graph into a
   `[0,1]` "close to the change?" score for the context re-ranker.

## Why not tree-sitter

The plan considered tree-sitter, but the implementation is a **hand-rolled lexical
scanner** — tree-sitter grammars are a native/`web-tree-sitter` dependency this repo
does not carry. The correctness guarantee is the _fallback_ (`complete: false` →
full suite), not the parse, so a conservative lexical index is the right trade.

## Invariant

```text
   over-approximate  →  a spurious edge runs a few extra tests (safe)
   under-approximate →  a missed edge skips a needed test (unsafe)
   ── so: any gap sets `complete: false`, and the caller runs the full suite.
```

## Modules

| Module         | What it provides                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `indexer.ts`   | `indexFiles` + `IndexedFile`/`IndexedSymbol`/`IndexedEdge`; `SymbolKind`, `DependencyKind`, `isTestFile`. |
| `graph.ts`     | `buildGraph` → `DependencyGraph` (forward + reverse adjacency, `incompleteFiles`).                        |
| `affected.ts`  | `affectedTests` → `{ tests, complete }` (transitive closure + safety flag).                               |
| `proximity.ts` | `dependencyProximity` — graph-distance → `[0,1]` re-rank signal.                                          |

## Affected-test contract

| condition                              | result                       |
| -------------------------------------- | ---------------------------- |
| complete, non-empty closure            | run just the affected tests. |
| `complete: false` OR empty / unindexed | run the full suite.          |

`TargetedVerifier` (in `verification-engine`) owns the _policy_; this package owns
the _graph_; neither imports the other.

## Test strategy

- Fixture-driven: a synthetic tree of modules (static + dynamic imports, bare
  packages) asserts the affected closure and, critically, that each gap flips
  `complete` to `false`.
- No native dependency, no `git`, no network — the leaf is hermetic.

## Directory structure

```
src/
├── index.ts
├── indexer.ts
├── graph.ts
├── affected.ts
└── proximity.ts
```

## Public API surface

```typescript
// indexFiles, IndexedFile, IndexedSymbol, IndexedEdge, SymbolKind, DependencyKind, isTestFile,
// buildGraph, DependencyGraph, affectedTests, AffectedTestsResult, dependencyProximity
```

## Dependency rule

```
packages/code-index → node built-ins only (no @harness/* runtime import)
```

The `code_index_symbols` / `code_index_deps` tables live in `@harness/db`; `db`
holds the tables, not the parser.
