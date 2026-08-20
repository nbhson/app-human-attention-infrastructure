# Day 15 — Week 3 Checkpoint: Targeted Verification Faster + Still Correct

| | |
|---|---|
| **Week** | 3 — Dependency graph → targeted verify |
| **Spec refs** | Spec 7 §5.2–5.3 (targeted/incremental verification), §5.5 (execution environment) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 14 (targeted/incremental verification via the graph) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A **targeted-vs-full comparison** on a seeded change corpus proving that (a) targeted verification is *faster* (wall-clock + test-count reduction) and (b) it is *still correct* (zero regressions slipped through vs the full-suite baseline).
2. A passing **correctness harness**: for each change, run FULL and TARGETED and assert the pass/fail verdicts match.
3. A **Week 3 retrospective note** capturing the list of changes where targeted *would have* disagreed with full (and why — every such case is a graph bug, not a coincidence).
4. Confidence that the W3 milestone — "a change runs only affected tests, faster and still correct" — is met.

**Do not proceed to Day 16 until every acceptance criterion in §5 is green.**

---

## 2. What Week 3 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| tree-sitter symbol index + import edges | `@harness/code-index` | ✅ Day 11 |
| Dependency graph + transitive closure (Postgres) | `@harness/code-index` | ✅ Day 12 |
| Impact analysis (change → affected tests) | `@harness/verification-engine` | ✅ Day 13 |
| Targeted/incremental verification + result cache | `@harness/verification-engine` | ✅ Day 14 |

---

## 3. Tasks

### 3.1 Correctness comparison harness (120 min)

- [ ] `apps/api/src/__tests__/week3-targeted-correctness.test.ts`:
  - Seed N changes (mix: single-file, cross-module, barrel-touching, unresolved-import-adjacent).
  - For each: run FULL (baseline verdict) and TARGETED (graph verdict).
  - Assert verdicts match (`PASSED`/`FAILED`) and the targeted set is a strict subset of the full set.
  - Record wall-clock + `ranTests`/`skippedTests` per change into a comparison table.

### 3.2 Latency reduction measurement (90 min)

- [ ] Build a `scripts/bench-targeted.ts` reporting per change: full duration vs targeted duration, test-count reduction %, and cache-hit rate.
- [ ] Document the p50/p95 speedup numbers into `docs/retros/week-03-phase3.md`.

### 3.3 Fix any verdict mismatches (up to 120 min)

- [ ] For every FULL-vs-TARGETED disagreement: trace the graph edge that caused it (stale index? missing `test` edge? barrel fan-out? unresolved import?). Fix the root cause or, if a genuine graph limitation, widen the confidence gate (Day 13 §2.2).
- [ ] **None may remain unresolved** and silently marked "known limitation" without a concrete, ticketed follow-up.

### 3.4 Week 3 retro (45 min)

File: `docs/retros/week-03-phase3.md` (`# Week 3 Phase 3 Retro — Dependency graph → targeted verify`), standard sections.

Prompts: How many verdict mismatches were found and why? Is `targeted_max_ratio` correctly placed? Does the incremental cache invalidation handle the fixture set without poison? Where is the remaining full-suite p95 cost?

### 3.5 Update wiring map + README (30 min)

- [ ] `docs/architecture/wiring-map.md` — `SymbolIndex`, `GraphBuilder`, `ImpactAnalyzer`, `TargetedVerification`, `ResultCache`.
- [ ] `README.md` — "Phase 3 Week 3 Status" note.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/__tests__/week3-targeted-correctness.test.ts` | FULL vs TARGETED correctness comparison |
| `scripts/bench-targeted.ts` | Latency-reduction measurement |
| `docs/retros/week-03-phase3.md` | Retrospective (with speedup numbers) |
| `README.md` (updated) | Week 3 status section |

---

## 5. Acceptance Criteria

- [ ] FULL and TARGETED verdicts match on 100% of the seeded change corpus.
- [ ] Targeted runs a strict subset of the full suite in every non-LOW-confidence case.
- [ ] Measurable speedup recorded: p95 targeted duration < p95 full duration, with test-count reduction % noted.
- [ ] Every FULL-vs-TARGETED mismatch has a documented root cause and fix (or a ticketed widening gate).
- [ ] `pnpm --filter @harness/verification-engine test` and `pnpm --filter @harness/code-index test` — all pass.
- [ ] `pnpm lint` — zero errors; `pnpm -r typecheck` — zero errors.
- [ ] `docs/retros/week-03-phase3.md` exists with real numbers.

**Checkpoint rule:** If any criterion is red, stop. A verification strategy that is faster *but wrong* is worse than the full suite it replaced — this is the one checkpoint where "still correct" strictly dominates "faster."

---

## 6. Notes & Pitfalls

- **Correctness first, speed second.** The milestone is "faster **+ still correct**." If you can only deliver one, deliver correctness and note the speed gap honestly in the retro. Do not ship a faster-but-wrong targeted path.
- **A mismatch is a graph bug, not a coin flip.** If targeted disagrees with full, something in the index/closure/confidence is wrong. Chase it to the edge. "It's ~fine" is not a valid root cause.
- **The comparison corpus must include the hard cases.** Single-file changes will trivially agree. Include barrel, cross-module, and unresolved-import-adjacent changes — that's where targeted verification fails silently if it's going to fail.
- **Cache hits vs correctness.** A cache-reused PASSED result must be excluded from the "verdict agreement" assertion (it's not a fresh verdict). Compare fresh-vs-fresh, and count cache hits separately.
- **Do not start hybrid context today.** Week 4 is another hard boundary. A clean, provably-correct targeted-verify foundation is worth more than a head start on semantic ranking.
- **Tomorrow (Day 16):** hybrid retriever as default — BM25 lexical + embedding semantic fused.

---

*Prev: [Day 14 — Targeted/Incremental Verification: Run Only Affected Tests via Graph](day-14.md) | Next: [Day 16 — Hybrid Retriever as Default: BM25 Lexical + Embedding Semantic Fused](day-16.md)*
