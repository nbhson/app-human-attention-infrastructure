# Day 14 — Targeted/Incremental Verification via Dependency Graph

| | |
|---|---|
| **Week** | 3 — Verification breadth |
| **Spec refs** | Spec 7 §5.2–5.3 (symbol index + dependency graph); Phase-3 README §4 (code-index package) |
| **Estimated effort** | 8h |
| **Prerequisites** | Days 11–13 (clone → sandbox run → evidence); `tree-sitter` available for the symbol index |

---

## 1. Objectives

By end of day you will have:

1. A new `@harness/code-index` package: **tree-sitter symbol index** + a **dependency graph** in Postgres, feeding *targeted* verification.
2. Given a PR's changed files, compute the **transitive set of affected packages/tests** — run only those tests instead of the full suite (which Phase 2 ran).
3. A `TargetedVerifier` that shortens verification without changing its verdict semantics (same PASSED/FAILED, smaller test set).
4. Prove correctness-equivalence: targeted-run results agree with full-run results on recorded fixtures.

This day makes W3's "faster + still correct" achievable; Day 15 checks out the checkpoint.

---

## 2. Design Decisions

### 2.1 Symbols + edges, not just filenames

The dependency graph needs *referential* edges (imports/calls), so tree-sitter parses each source file into **symbols** (defs/refs) and edges (`file A imports file B`, `test T imports module M`). A changed symbol maps to its tests; a changed test maps to itself. Postgres rows: `symbols(file, kind, name, range)` and `deps(from_file, to_file, kind)`.

### 2.2 Affected-set computation

`affectedTests(changedFiles)`: seed with changed files → follow `deps` reverse edges to files that import them → collect tests transitively. Cache the graph; rebuild incrementally on diff change.

### 2.3 Targeted is a *candidate set*, correctness stays measurable

Targeted verification runs the affected tests; it is **correct** only if (a) the full suite would also pass, and (b) failures are never missed. The safety net: when the graph is incomplete (unparsed file, dynamic require), **fall back to the full suite** rather than guess. A targeted run that skips a test the graph can't prove irrelevant is a miss.

### 2.4 `@harness/code-index` never imports another engine

Depends only on `@harness/domain`, `@harness/db`, `@harness/di` — verification-engine *consumes* it via a seam (resolver/event), never a direct import into internals.

---

## 3. Tasks

### 3.1 Scaffold `@harness/code-index` (45 min)

- [ ] `package.json` (`@harness/code-index`), `tsconfig`, boundary entry; deps domain/db/di + tree-sitter.

### 3.2 Symbol index (90 min)

- [ ] `packages/code-index/src/indexer.ts` — parse files via tree-sitter → symbols; store in `symbols`.

### 3.3 Dependency graph schema + build (90 min)

- [ ] `packages/db/src/schema/code-index.ts` — `symbols` + `deps` tables + migration.
- [ ] `packages/code-index/src/graph.ts` — build `deps` edges from defs/refs.

### 3.4 `affectedTests` (90 min)

- [ ] `packages/code-index/src/affected.ts` — transitive affected-test computation + fallback trigger.

### 3.5 `TargetedVerifier` (90 min)

- [ ] `packages/verification-engine/src/targeted-verifier.ts` — run affected tests via Day-12 sandbox runner; fallback to full suite on graph gap.

### 3.6 Tests (90 min)

- [ ] Graph built from a fixture monorepo; `affectedTests` correct for a changed leaf.
- [ ] Equivalence fixture: targeted PASSED/FAILED agrees with full run.
- [ ] Fallback triggered on unparsed/dynamic import.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/code-index/package.json` + `src/index.ts` | New `@harness/code-index` package |
| `packages/code-index/src/indexer.ts` | tree-sitter symbol index |
| `packages/code-index/src/graph.ts` | Dependency graph build |
| `packages/code-index/src/affected.ts` | `affectedTests` + fallback |
| `packages/db/src/schema/code-index.ts` | `symbols` + `deps` schema |
| `packages/verification-engine/src/targeted-verifier.ts` | Targeted + fallback verification |

---

## 5. Acceptance Criteria

- [ ] `symbols` + `deps` tables exist; graph builds from a fixture repo.
- [ ] `affectedTests(changedFiles)` returns the correct transitive test set.
- [ ] Targeted verification runs fewer tests than the full suite on a fixture with a leaf change.
- [ ] Targeted PASSED/FAILED agrees with full-run on equivalence fixtures.
- [ ] Graph gap (dynamic import/unparsed) → full-suite fallback.
- [ ] Boundary: `code-index` imports only domain/db/di.

---

## 6. Notes & Pitfalls

- **Correctness, not just speed.** Missing a failing test is a verification lie. The fallback-to-full-suite path is the guarantee — ship it first, then optimize.
- **Tree-sitter grammars are per-language.** Scope the index to the languages the repo actually uses (TS/JS first); unsupported files are a fallback trigger, not an error.
- **Rebuild the graph on change.** A stale graph silently mis-routes; tie the rebuild to the clone/diff lifecycle.
- **Day 15** checkpoint: real PR tests in sandbox, faster + still correct.

---

*Next: [Day 15 — Week 3 Checkpoint: Real PR Tests in Sandbox, Faster + Still Correct](day-15.md)*