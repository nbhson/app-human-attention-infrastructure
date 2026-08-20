# Day 13 — Impact Analysis: Map a Change to Affected Tests (Transitive)

| | |
|---|---|
| **Week** | 3 — Dependency graph → targeted verify |
| **Spec refs** | Spec 7 §5.2 (targeted: changed files + direct dependencies), §5.3 (incremental), Spec 5 §2.2 (FileChange) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 12 (dependency graph + transitive closure in Postgres) |

---

## 1. Objectives

By end of day you will have:

1. An **impact analyzer** that maps a change's `files_affected` → the transitive set of affected source files → the test files that cover them via the dependency closure.
2. A **change-to-tests selection** that is conservative by default: when confidence is low (unresolved imports, dynamic imports, missing edges), it *widens* the test set toward the full suite rather than narrowing and risking false negatives.
3. Persisted `impact_analysis` results linking a change id to the computed affected-test set, for audit and for Day 14 to consume.

This is the "which tests matter" half of targeted verification. Day 14 turns it into an actual verify run.

---

## 2. Design Decisions

### 2.1 From change → affected tests (three passes)

```typescript
// packages/verification-engine/src/impact/impact-analyzer.ts
export interface ImpactAnalysis {
  changeId: string;
  changedFiles: string[];
  affectedSource: string[];     // transitive dependents of changed files (the blast radius)
  affectedTests: string[];      // test files importing, directly or transitively, affected sources
  confidence: ImpactConfidence; // 'HIGH' | 'MEDIUM' | 'LOW'
  unresolvedImports: string[];  // imports the graph couldn't resolve (forces widening)
  computedAt: Date;
}

export class ImpactAnalyzer {
  constructor(private readonly graph: ClosureGraph) {}

  async analyze(change: FileChange[]): Promise<ImpactAnalysis> {
    // Pass 1 — forward dependencies of each changed file (what the change breaks)
    //   affected = getDependencies(changedFile)  ∪  getDependents(changedFile)
    //   (a change breaks its own dependents; and its imports are in scope for re-test)
    // Pass 2 — map affected -> tests: every test file whose getDependencies(test) intersects affected
    // Pass 3 — confidence + widening (below)
  }
}
```

The union of both directions is deliberate: changing `A` affects `A`'s dependents (callers break) *and* `A`'s dependencies (the change may exercise them differently). Spec 7 §5.2 says "changed files **and their direct dependencies**"; the transitive closure extends "direct" safely.

### 2.2 Confidence-gated widening (the false-negative defense)

The whole week's pitfall is targeted verification missing a test that *would* have caught a regression. Confidence derives from graph quality:

| Signal | Effect |
|--------|--------|
| Any `unresolvedImports` in the closure | `LOW` — widen to full suite (or significantly larger set) |
| `dynamic` import edges in scope | `MEDIUM` — include the dynamic target's direct tests conservatively |
| `re-export` barrel in the path | `MEDIUM` — treat the barrel's downstream as in-scope (bounded depth) |
| Test files not indexed / stale | `LOW` — cannot prove coverage; widen |

```typescript
function widening(analysis: ImpactAnalysis): string[] {
  if (analysis.confidence === 'LOW') return fullSuiteTests;   // safe fallback
  if (analysis.confidence === 'MEDIUM') return union(affectedTests, directDependencyTests);
  return affectedTests;
}
```

**Default to wider, never narrower.** A false negative (missed regression) is worse than a false positive (running a few extra tests). This asymmetry is the day's core principle.

### 2.3 Persisted impact result

```typescript
// packages/db/src/schema/impact.ts
export const impactAnalyses = pgTable('impact_analyses', {
  id:                 text('id').primaryKey(),
  change_id:          text('change_id').notNull(),
  changed_files:      jsonb('changed_files').notNull(),
  affected_tests:     jsonb('affected_tests').notNull(),
  confidence:         text('confidence').notNull(),
  unresolved_imports: jsonb('unresolved_imports').notNull().default([]),
  computed_at:        timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Persisting the analysis makes Day 14's test run reproducible and Day 15's "still correct" comparison (targeted vs full) auditable.

### 2.4 Blast-radius numbers also feed Attention (Spec 6 impact factor)

The `affectedSource` set is exactly the "blast radius" the Attention Engine's Impact Analyzer wants (Spec 6 §3.2: "blast radius via dependency graph"). Expose `affectedSource.length` (and file list) as a consumable signal — but wire it through an interface/event, not a direct import (keep the engine boundary).

---

## 3. Tasks

### 3.1 Schema + migration (30 min)

- [ ] `packages/db/src/schema/impact.ts` — `impact_analyses` (§2.3). Generate + migrate.

### 3.2 `ImpactAnalyzer` (150 min)

- [ ] `packages/verification-engine/src/impact/impact-analyzer.ts` — three passes (§2.1).
- [ ] Confidence computation + widening (§2.2).
- [ ] Persist `impact_analyses` row per analysis.

### 3.3 Closure depth + barrel handling (90 min)

- [ ] Add `maxDepth`-capped traversal; cap `re-export` barrel expansion at a bounded depth (§2.2 note).
- [ ] Record `unresolvedImports` from Day 11's `imported = null` rows.

### 3.4 Attention signal seam (45 min)

- [ ] Emit `impact.analyzed { changeId, affectedSourceCount, affectedTestCount, confidence }` for the Attention Engine's impact factor.
- [ ] No direct `attention-engine` import — event only.

### 3.5 Tests (150 min)

- [ ] Fixture: change `B` (A→B→C, testT→B, testU→C); assert `affectedSource = {B, C, A?}` (per direction rules) and `affectedTests ⊇ {testT, testU}`.
- [ ] Unresolved import in scope → confidence `LOW` → widened to full suite.
- [ ] Barrel in path → `MEDIUM` → includes bounded downstream tests.
- [ ] Empty `files_affected` → throws (never silently empty set).
- [ ] Boundary test on `@harness/verification-engine`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/verification-engine/src/impact/impact-analyzer.ts` | `ImpactAnalyzer`, `ImpactAnalysis` |
| `packages/db/src/schema/impact.ts` | `impact_analyses` |
| `packages/verification-engine/src/__tests__/impact.test.ts` | Change→tests + widening tests |
| `apps/api/src/bootstrap.ts` (updated) | `ImpactAnalyzer` registration |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/verification-engine test` — all tests pass.
- [ ] Changing a file selects its dependents' and dependencies' tests transitively (fixture-proven).
- [ ] `LOW` confidence widens to the full suite; `MEDIUM` includes bounded barrel/dynamic downstream; `HIGH` returns the precise set.
- [ ] No empty `affectedTests` for a change into non-empty source (widening guarantees a safe set).
- [ ] `impact_analyses` row persists `change_id` → `affected_tests` for audit.
- [ ] `impact.analyzed` event carries blast-radius counts (Attention signal).
- [ ] `pnpm lint` clean; `packages/verification-engine` boundary intact (no `code-index` or `attention-engine` import).

---

## 6. Notes & Pitfalls

- **Widening is a one-way door toward safety.** Never narrow below the graph's precise set when confidence is anything but `HIGH`. A missed regression is a correctness bug in the harness; a few extra tests are only a latency cost.
- **Transitive blast radius can explode.** Barrel files and shared utils can make `affectedSource` the whole repo; that's a *signal* (the change is broadly impactful) but must not silently become "de facto full suite" while claiming "targeted." Cap depth, keep the confidence label honest, and report the blast radius.
- **Unresolved imports are the biggest false-negative source.** If the graph cannot resolve an import, it cannot know what depends on what. Downgrade confidence to `LOW` and widen — do not paper over with a wildcard guess.
- **Both graph directions matter.** Dependents (callers break) AND dependencies (the change touches what it calls) — pick only one and you miss the other half of the blast radius.
- **Persist the analysis, not just the answer.** Day 15 will diff targeted-vs-full *per change*; without the persisted `affected_tests` you cannot reconstruct what "targeted" ran.
- **Tomorrow (Day 14):** targeted/incremental verification — run only the affected tests via the graph (Spec 7 §5.2–5.3).

---

*Prev: [Day 12 — Dependency Graph Build (File/Module Edges) in Postgres](day-12.md) | Next: [Day 14 — Targeted/Incremental Verification: Run Only Affected Tests via Graph](day-14.md)*
