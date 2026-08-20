# Day 26 — Benchmark Corpus: Versioned Gold Labels (SWE-bench-style Tasks)

| | |
|---|---|
| **Week** | 6 — Benchmark + judge |
| **Spec refs** | Spec 11 §5.1 (benchmark corpus: versioned/frozen gold labels, composition), §5.2 (Minimal Benchmark Harness) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 25 (Week 5 checkpoint — multi-agent demo + guardrail proofs) |

---

## 1. Objectives

By end of day you will have:

1. A new package `packages/benchmark` (`@harness/benchmark`) with a **corpus model**: frozen, versioned tasks whose correct outcomes were confirmed by real human review + downstream absence of defects (Spec 11 §5.1).
2. **Gold-label versioning**: every evaluation run pins a `corpus_version`; a calibration change cannot silently ret-con the labels it is scored against.
3. **Corpus composition** spanning the real-traffic mix (routed-to-human, auto-approvable, REWORK, defect-caught-later) — anti-overfit, not "pick the easy majority class."
4. A **seed corpus** built from Phase 1/2 historical tasks (sampled + label-verified), ready for Day 27's runtime and Day 30's E2E.

This is the measurement substrate: the frozen held-out set against which every later capability/capability-change is scored.

---

## 2. Design Decisions

### 2.1 Corpus task record (SWE-bench-style, adapted)

```typescript
// packages/benchmark/src/corpus.ts
export interface BenchTask {
  id: string;                      // stable, content-addressed
  corpusVersion: string;           // semantic version of the corpus snapshot
  repo: string;                    // target repo fixture
  baseCommit: string;              // starting point (SWE-bench style)
  problemStatement: string;        // the task description
  goldPatch: string;               // confirmed correct change (human-verified)
  goldTests: string[];             // tests that must pass for success
  label: 'HUMAN_ROUTED' | 'AUTO_APPROVABLE' | 'REWORK' | 'DEFECT_CAUGHT_LATER';
  sourceTaskId?: string;           // provenance back to the real task that seeded it
  frozenAt: Date;
}
```

The gold label is **not** "did the agent pass" — it's the confirmed outcome (gold patch + tests) that downstream defect-absence verified (Spec 11 §5.1).

### 2.2 Versioning + freezing

- A `corpus_version` (e.g. `v1`) pins the whole set. A new capability is scored against the *pinned* version; labels only change by **re-versioning the corpus** (never by editing in place).
- `frozenAt` records when the corpus was frozen. Any calibration change re-runs against the frozen version, so its labels cannot be ret-conned.

```sql
-- corpus_versions + bench_tasks (bench_tasks.corpus_version = corpus_versions.id)
```

### 2.3 Composition mirror (anti-overfit)

Spec 11 §5.1: corpus composition mirrors real traffic. Seed with an explicit stratum mix:

| Label | Target share | Why |
|-------|------|-----|
| `HUMAN_ROUTED` | ~50% | the core review population — must dominate |
| `AUTO_APPROVABLE` | ~20% | so the judge isn't only tested on hard cases |
| `REWORK` | ~20% | failure patterns the pipeline must catch |
| `DEFECT_CAUGHT_LATER` | ~10% | the missed-signal class (recall-critical) |

The seed need not be large (~30–50 tasks); it needs to be *representative* and *frozen*, not exhaustive.

### 2.4 Gold-label provenance

Every gold label traces back to the real evidence that confirmed it (the human decision + downstream defect-absence window). Store `sourceTaskId` + a `label_evidence` link so a task's "gold" status is itself evidence-backed — the benchmark must not be an assertion without evidence, or it inherits the exact failure the harness exists to prevent.

### 2.5 Package boundary

`@harness/benchmark` imports `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di` only. It defines the corpus; it does **not** call the Agent Runtime or Context Engine directly — Day 27's runtime consumes the corpus through the harness's sandbox boundary (Spec 11 §5.2: "a score measures HAI's real pipeline").

---

## 3. Tasks

### 3.1 Scaffold `packages/benchmark` (30 min)

- [ ] `package.json`, `tsconfig.json`, barrel; add to boundary config.

### 3.2 Corpus model + schema (90 min)

- [ ] `corpus.ts` — `BenchTask`, `label`, `corpusVersion` (§2.1).
- [ ] `packages/db/src/schema/benchmark.ts` — `corpus_versions`, `bench_tasks`, `bench_labels` (gold-label evidence links). Generate + migrate.

### 3.3 Seed corpus extraction (120 min)

- [ ] `seed-corpus.ts`: sample historical tasks from the Phase 1/2 decision log; apply the stratum mix (§2.3); attach `goldPatch`/`goldTests`/`sourceTaskId`/`label_evidence`.
- [ ] Freeze as `corpus_version = v1`; write `frozenAt`.

### 3.4 Versioning + immutability tests (90 min)

- [ ] Labels are immutable within a version (no in-place edit; re-version only).
- [ ] Two evaluation runs pin the same `corpusVersion` and see identical labels.
- [ ] Every `BenchTask` has a `goldPatch` + ≥1 `goldTests` + label evidence.

### 3.5 Composition audit (60 min)

- [ ] A report asserts the stratum mix is within tolerance (no all-`HUMAN_ROUTED` degenerate corpus).
- [ ] Reject a corpus whose `DEFECT_CAUGHT_LATER` share is 0 (recall blind spot).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/benchmark/package.json` + `tsconfig.json` + barrel | New package |
| `packages/benchmark/src/corpus.ts` | `BenchTask`, labels, versioning |
| `packages/db/src/schema/benchmark.ts` + migration | Corpus tables |
| `packages/benchmark/src/seed-corpus.ts` | Seed + freeze `v1` |
| `packages/benchmark/src/__tests__/corpus.test.ts` | Version/freeze/composition tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/benchmark test` — all tests pass.
- [ ] A frozen `corpus_version = v1` exists with `frozenAt`; labels are immutable within a version.
- [ ] Every `BenchTask` has `goldPatch`, ≥1 `goldTests`, and label evidence (from real decision log).
- [ ] Stratum mix matches the target shares within tolerance; `DEFECT_CAUGHT_LATER` > 0.
- [ ] Re-versioning creates a *new* corpus version (no in-place label edits).
- [ ] `@harness/benchmark` imports only the four allowed packages.
- [ ] `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **The corpus is frozen *per evaluation run*.** Spec 11 §5.1 is explicit: freezing prevents the optimizer from ret-conning labels mid-score. Any "improvement" that edits labels instead of re-versioning is cheating, and the version pin is what catches it.
- **Gold = human-confirmed + downstream-absent, not "the model got it right."** A label derived from the *agent's own* output is circular. Every gold label needs `label_evidence` tracing to the human decision and the defect-absence window.
- **A homogeneous corpus hides regressions.** If `DEFECT_CAUGHT_LATER` is zero, the corpus can never catch a recall regression (the exact failure class Phase 2 measured). Guard against it in composition.
- **Don't over-build the corpus.** ~30–50 representative frozen tasks beat 10,000 unlabeled ones. Week 6's value is the *judge + closed loop*, not corpus size.
- **Seed from real traffic, not synthetic happy paths.** The seed must pull from the actual decision log — a synthetic "everything passes" corpus teaches the judge nothing about the cases that matter.
- **Tomorrow (Day 27):** benchmark runtime — Minimal Benchmark Harness container (bash + editor) (Spec 11 §5.2).

---

*Prev: [Day 25 — Week 5 Checkpoint: Multi-agent Demo + Guardrail Proofs](day-25.md) | Next: [Day 27 — Benchmark Runtime: Minimal Benchmark Harness Container (bash + editor)](day-27.md)*
