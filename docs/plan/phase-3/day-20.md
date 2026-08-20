# Day 20 — Week 4 Checkpoint: Lost-in-middle + Freshness Under Hybrid; Clean Cutover

| | |
|---|---|
| **Week** | 4 — Hybrid context default |
| **Spec refs** | Spec 4 §5.2.2 (lost-in-the-middle), §5.2.4 (validation gate), §8 (freshness), §5.1 (hybrid default, re-rank) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 19 (hybrid default cutover via A/B gate) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A **lost-in-the-middle test** proving the highest-value sources sit at the *head* of delivered context under hybrid + re-rank (Spec 4 §5.2.2), not mid-prompt.
2. A **freshness test** proving STALE target files are still re-resolved/handled correctly under the hybrid path (Spec 4 §8, §5.2.4).
3. A **clean cutover confirmation**: the shadow keyword baseline is retired against default hybrid with no correctness regression, and the cutover is auditable.
4. A **Week 4 retrospective note**.

**Do not proceed to Day 21 until every acceptance criterion in §5 is green.**

---

## 2. What Week 4 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Hybrid retriever (BM25 + semantic) + RRF | `@harness/context-engine` | ✅ Day 16 |
| Re-rank (value/dependency/recency/usage) + target pin | `@harness/context-engine` | ✅ Day 17 |
| RAG Fusion (multi-query + RRF), opt-in | `@harness/context-engine` | ✅ Day 18 |
| `rank_method` cutover + A/B rollout gate | `@harness/context-engine` | ✅ Day 19 |

---

## 3. Tasks

### 3.1 Lost-in-the-middle test (90 min)

- [ ] `lost-in-middle.test.ts`: deliver a hybrid context and assert the highest-value sources (by a fixed ground-truth ranking: target files first, then dependency-closest, then recency) appear in the **first third** of the delivered order, not the middle.
- [ ] Assert the re-rank `before → after` moved ground-truth top items toward the head (measured, recorded in snapshot metadata).

### 3.2 Freshness under hybrid (75 min)

- [ ] Change a target file after a snapshot's `content_hash` was captured; assert the hybrid path still detects STALE and re-resolves (Spec 4 §8) — the retriever must not serve a poisoned/stale source.
- [ ] Assert the §5.2.4 validation gate still hard-fails on budget breach and missing target files under hybrid.

### 3.3 Cutover confirmation + shadow retirement (90 min)

- [ ] Re-run the acceptance criteria from Day 19: `metric_gates` row exists, `rank_method` default is `hybrid`, snapshot metadata carries shadow keyword order from the window.
- [ ] Retire the shadow keyword computation (close the temporary double-rank) now that freshness/lost-in-middle pass; record the retirement timestamp.

### 3.4 Regression sweep (60 min)

- [ ] Re-run Phase 1/2 context tests under `hybrid` default; any test asserting the old `keyword` default must be updated to assert the *mechanism* (retriever seam) not the specific ranker.

### 3.5 Week 4 retro (45 min)

File: `docs/retros/week-04-phase3.md` (`# Week 4 Phase 3 Retro — Hybrid context default`), standard sections.

Prompts: Did hybrid actually win the A/B, or was the metric too forgiving? Is RAG Fusion worth its cost on real queries? Is the target-file pin holding under adversarial fixtures? Any freshness path where hybrid returned stale content?

### 3.6 Update wiring map + README (30 min)

- [ ] `docs/architecture/wiring-map.md` — `HybridRetriever`, `HeuristicReRanker`, `RagFusionRetriever`, rank gate.
- [ ] `README.md` — "Phase 3 Week 4 Status" note.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/__tests__/week4-hybrid-checkpoint.test.ts` | Lost-in-middle + freshness + cutover |
| `docs/retros/week-04-phase3.md` | Retrospective |
| `README.md` (updated) | Week 4 status section |

---

## 5. Acceptance Criteria

- [ ] Hybrid default delivers highest-value sources at the head (not mid-prompt) — lost-in-middle test passes.
- [ ] STALE target files are detected and re-resolved under hybrid (freshness test passes).
- [ ] §5.2.4 validation gate still hard-fails on budget breach and missing target files under hybrid.
- [ ] `rank_method` default is `hybrid`; `metric_gates` row records the winning A/B; shadow keyword computation retired.
- [ ] No Phase 1/2 context test regressed (or its *intent* is preserved when updated for the new default).
- [ ] `pnpm --filter @harness/context-engine test` — all pass; `pnpm lint` — zero errors.
- [ ] `docs/retros/week-04-phase3.md` exists.

**Checkpoint rule:** If hybrid is default but the lost-in-middle or freshness test is red, revert to `keyword` (Day 19 drill) and fix today. Do not carry a hybrid default that serves stale or misordered context into Week 5.

---

## 6. Notes & Pitfalls

- **"Clean cutover" means no double-rank left behind.** The shadow keyword rank was a *window*, not a permanent feature. Leaving both rankers live doubles the hot-path cost and erodes the whole latency story.
- **Lost-in-the-middle is a placement property, not just "top item first."** Verify the *distribution*: ground-truth top-K should concentrate at the head, not simply appear above the fold. A dozen medium sources dumped before the one critical one is still lost.
- **Freshness is a correctness gate, not a nicety.** If hybrid returns a STALE source without re-resolving, the whole retrieval upgrade inherits the exact stale-context bug Phase 1 already guards against. It must pass before the cutover is "clean."
- **Updating old tests must not weaken them.** When a Phase-1 test asserted `keyword` specific behavior, re-assert on the *retriever seam* result, not by hardcoding `hybrid` into the future. Tests that pin the wrong ranker become brittle.
- **Do not start multi-agent today.** Week 5 (bounded multi-agent) has the thorniest guardrail work of the phase. A clean, provably-correct hybrid-default foundation is the prerequisite.
- **Tomorrow (Day 21):** multi-agent primitives — MapReduce / Critique-Revision / Ensemble.

---

*Prev: [Day 19 — Integrate Hybrid Default: rank_method Cutover + A/B vs Shadow Baseline](day-19.md) | Next: [Day 21 — Multi-agent Primitives: MapReduce / Critique-Revision / Ensemble](day-21.md)*
