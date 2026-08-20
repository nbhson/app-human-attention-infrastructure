# Day 12 — Dependency Graph Build (File/Module Edges) in Postgres

| | |
|---|---|
| **Week** | 3 — Dependency graph → targeted verify |
| **Spec refs** | Spec 7 §5.2–5.3 (dependency graph for targeted/incremental verification), Spec 4 §4.1 (dependency graph for file scanning) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 11 (tree-sitter symbol index: symbols + imports persisted) |

---

## 1. Objectives

By end of day you will have:

1. A **dependency graph** in Postgres: directed edges from importer → imported files (and symbol-level edges), built from Day 11's `symbols` + `file_imports`.
2. A **transitive closure** query (`WITH RECURSIVE`) that answers "which files depend on file X" and "which files X depends on" at any depth.
3. Graph metadata (edge counts, cycle detection) persisted so the graph's correctness is auditable, not just computed.
4. A **graph rebuild** path and a staleness tie to the code index (a stale symbol index invalidates downstream edges).

The graph is the substrate for Day 13 (impact analysis) and Day 14 (targeted test selection).

---

## 2. Design Decisions

### 2.1 Edges table (file-level + symbol-level)

```typescript
// packages/db/src/schema/dependency-graph.ts
export const dependencyEdges = pgTable('dependency_edges', {
  id:          text('id').primaryKey(),            // SHA256(from + to + kind)
  project_id:  text('project_id').notNull(),
  from_file:   text('from_file').notNull(),        // importer
  to_file:     text('to_file').notNull(),          // imported
  kind:        text('kind').notNull(),             // 'import' | 're-export' | 'dynamic' | 'test'
  source_hash: text('source_hash').notNull(),      // fileImports/symbols content hash at build time
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  fromIdx: index('dep_from_idx').on(t.from_file),
  toIdx:   index('dep_to_idx').on(t.to_file),
  kindIdx: index('dep_kind_idx').on(t.kind),
}));
```

Edges derive from `file_imports` (importer/imported) and symbol references. `kind` distinguishes:
- `import` — static import (the bulk of the graph).
- `re-export` — barrel re-exports (critical: barrel files fan everything out).
- `dynamic` — `import()` calls (noted, but static targeting treats them cautiously).
- `test` — a test file importing a source file (the edge targeted verification most cares about).

### 2.2 Build = a deterministic projection + transitive materialization

The graph is *derived* data. Building it is a two-step pipeline:

1. **Project** `file_imports` (+ symbol references) → `dependency_edges` (idempotent upsert by content-addressed `id`).
2. **Materialize closure** into `dependency_closure (from_file, to_file, depth, path[])` so Day 13/14 queries are O(1)-ish, not recursive-hot-path.

```sql
-- transitive closure: all ancestors of a file (who depends on me, transitively)
INSERT INTO dependency_closure (from_file, to_file, depth, path)
WITH RECURSIVE closure AS (
  SELECT from_file, to_file, 1 AS depth, ARRAY[from_file, to_file] AS path
  FROM dependency_edges
  UNION ALL
  SELECT c.from_file, e.to_file, c.depth + 1, c.path || e.to_file
  FROM closure c
  JOIN dependency_edges e ON e.from_file = c.to_file
  WHERE NOT e.to_file = ANY(c.path)          -- cycle guard
)
SELECT * FROM closure;
```

**Why materialize?** The closure runs once per rebuild (offline), not per query. Day 14 runs "affected tests" per verification request; if that path does a live `WITH RECURSIVE` over a large graph it becomes the p95 driver it's supposed to remove.

### 2.3 Cycles are data, not errors

Cycles exist in real code (mutual imports). The closure's `NOT e.to_file = ANY(path)` guard prevents infinite recursion; cycles are recorded in a `graph_cycles` table (or `metadata`) and reported, never thrown. **Do not** treat a cycle as a build failure — it's a normal property of the codebase.

### 2.4 Staleness propagation (index → graph)

The graph is only as fresh as the index. `BuildGraphJob` checks, per project:

1. `code_index` staleness (any `symbols` row whose file `content_hash` no longer matches disk).
2. If stale files exist, re-index them first (Day 11 `indexFile`), then rebuild affected edges.

A graph edge rows carry `source_hash` so a rebuild can skip unchanged inputs.

### 2.5 Graph correctness audit

Persist `graph_stats { nodeCount, edgeCount, cycleCount, danglingImportCount, builtAt }` per project so "is the graph right?" is answerable with a query, not a feeling (Spec 7's "still correct" checkpoint on Day 15 needs this).

---

## 3. Tasks

### 3.1 Schema + migration (45 min)

- [ ] `packages/db/src/schema/dependency-graph.ts` — `dependency_edges`, `dependency_closure`, `graph_stats` (§2.1–2.5).
- [ ] Generate + migrate.

### 3.2 `GraphBuilder` (120 min)

- [ ] `packages/code-index/src/graph-builder.ts` — project `file_imports` → `dependency_edges` (idempotent, content-addressed).
- [ ] Detect + record cycles; emit `graph.cycle_detected`.
- [ ] Rebuild closure via `WITH RECURSIVE` with the cycle guard.

### 3.3 `BuildGraphJob` + staleness (75 min)

- [ ] Check code-index staleness; re-index stale files before rebuilding edges (§2.4).
- [ ] Skip unchanged inputs via `source_hash`.
- [ ] Write `graph_stats`; publish `graph.rebuilt { nodeCount, edgeCount, cycleCount }`.

### 3.4 Closure query API (60 min)

- [ ] `getDependents(file)` (who depends on me, transitive) and `getDependencies(file)` (what I depend on).
- [ ] Depth-capped variants (`maxDepth`) for Day 14.

### 3.5 Tests (120 min)

- [ ] A fixture repo (A→B→C, testT→B) yields the exact expected edges + closure.
- [ ] Cycle fixture (X↔Y) does not hang; `graph.cycle_detected` emitted; closure terminates.
- [ ] Rebuild is idempotent (second run changes no edge counts).
- [ ] Stale file re-indexes before rebuild (assert edge updated, not dropped).
- [ ] Boundary test on `@harness/code-index`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/dependency-graph.ts` | `dependency_edges`, `dependency_closure`, `graph_stats` |
| `packages/code-index/src/graph-builder.ts` | `GraphBuilder`, `BuildGraphJob` |
| `packages/code-index/src/closure.ts` | `getDependents` / `getDependencies` |
| `packages/code-index/src/__tests__/graph.test.ts` | Edge/closure/cycle/staleness tests |
| `apps/api/src/bootstrap.ts` (updated) | Graph job DI registration |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/code-index test` — all tests pass.
- [ ] A→B→C fixture yields dependents/dependencies closures with exact membership and depth.
- [ ] `WITH RECURSIVE` closure terminates on a cycle (X↔Y) and records the cycle.
- [ ] Rebuild is idempotent (edge count stable across two runs).
- [ ] `test`-kind edges are present for test files importing source (needed by Day 14).
- [ ] Stale code-index files are re-indexed before the graph rebuild.
- [ ] `graph.rebuilt` event and `graph_stats` row are produced after each build.
- [ ] `pnpm lint` clean; `packages/code-index` boundary intact.

---

## 6. Notes & Pitfalls

- **Barrel files dominate the graph.** `index.ts` re-exports fan everything out; if `re-export` edges are treated as plain imports, targeted verification still pulls half the repo. Tag `kind='re-export'` and weight/limit them in Day 13's impact analysis.
- **Materialize the closure, or it bites.** A live `WITH RECURSIVE` on the hot path defeats the entire point of targeted verification. The closure table is the performance decision — do not "optimize later."
- **The cycle guard must not silently drop edges.** `NOT e.to_file = ANY(path)` prevents infinite recursion but can omit some legitimate longer paths. Accept the trade-off, record it in `graph_stats.cycleCount`, and note it for the Day 15 correctness comparison.
- **Do not edit edges in place.** Like the symbol index, dependency edges are content-addressed and append-derived. Rebuilds always project fresh; superseded edges are pruned, not updated.
- **Test edges are the load-bearing detail.** If `test.ts → source.ts` edges are missing, Day 14 has nothing to select from and falls back to "full suite" silently. Make the test fixture assert these explicitly.
- **Tomorrow (Day 13):** impact analysis — map a change to affected tests transitively via the closure.

---

*Prev: [Day 11 — tree-sitter Symbol Index: Functions/Classes/Imports](day-11.md) | Next: [Day 13 — Impact Analysis: Map a Change to Affected Tests (Transitive)](day-13.md)*
