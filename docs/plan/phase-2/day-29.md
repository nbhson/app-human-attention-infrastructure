# Day 29 — A/B Dry-Run End-to-End: Keyword vs Semantic Context Ranking Head-to-Head

| | |
|---|---|
| **Week** | 6 — Harden + exit review |
| **Spec refs** | Spec 11 §5 (A/B shadow harness), Spec 4 §5.1 (shadow rule), Spec 3 §6.1 (replay), Spec 6 §3.4 (weights/vote on priority) |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Day 9 (A/B harness), Days 16–18 (semantic index + shadow rank), Day 27 (E2E green) |

---

## 1. Objectives

By end of day you will have:

1. A **real head-to-head A/B run** — the Day-9 harness splits traffic between two `ContextRanker` variants (A = keyword, B = semantic) and produces a **dry-run** comparison: each variant's ranking logged, the *chosen* variant's outcome recorded, but the semantic variant's ranking never mutated production state.
2. **Routing-quality comparison on real outcome data** — the two variants compared on Spec 11 §4's outcome signals (did the task's produced context get used? was the task accepted without re-routing?), *not* on ranking-adjacent proxies.
3. A **decision recommendation** for Day 30 — enough evidence to say "semantic ranking should be the Phase-3 default / promoted to a real A/B / kept in shadow" with the numbers to back the call.
4. The **harness itself validated** — a dry-run that found zero `rank_correlation` or no usable outcome signal is a broken harness, and must be fixed, not waved through.

Day 29 is Week 4's payoff and Week 6's final proof: the semantic shadow has been *measured* for weeks; now it's *compared* under the harness that, if the data supports it, is the mechanism by which Phase 3 promotes semantic ranking.

---

## 2. Design Decisions

### 2.1 The variants are `ContextRanker`s behind the existing seam

The Day-9 `AbHarness` already treats a "pipeline variant" as an interchangeable step. Today the variant is *just the context-ranking step* (nothing else changes — the rest of the pipeline is identical A/B):

```typescript
// packages/evaluation/src/ab/ranking-variants.ts
variants: [
  { id: 'keyword',  contextRanker: keywordRanker },   // A (control, current default)
  { id: 'semantic', contextRanker: semanticRanker },  // B (shadow challenger)
]
```

Keeping the *only* difference as the ranker isolates the comparison — if auth/verification/metrics also differ between arms, the signal is unreadable. (Spec 11 §5's rule: vary one thing.)

### 2.2 Dry-run = shadow write, control serve

Every `semantic`-arm run still serves its snapshot with `rank_method = 'keyword'` at merge time? No — within the A/B harness, arm B's snapshot *does* carry `rank_method = 'semantic'` in the harness's own record, but the **production** path (task outcome, review queue) is fed from arm A's keyword result. The dry-run never lets arm B's ordering write to a served `ContextSnapshot` used by the live agent.

Concretely: the harness observes both arms' rankings, records both, but the orchestrator's downstream steps consume arm A. Outcome comparison then asks "given each arm's ranking, would the outcome have differed" via replay (Spec 3 §6.1), not by mutating the live run.

### 2.3 Compare on outcome signals, not ranking proxies

Metrics per variant (non-exhaustive, Spec 11 §4 + §4.1):

```text
context_acceptance_rate   -- did the ranked context survive the validation gate unchanged
human_minutes_per_accept  -- downstream dwell/decision cost on the chosen arm
rework_rate               -- tasks that required re-routing / re-work
```

`rank_correlation` (Day 18) is a *cheap screen*, not the verdict. The verdict comes from outcome signals. A variant can rank "differently" yet produce identical outcomes — and if so, semantic ranking has no measured value yet.

### 2.4 Minimum-evidence bar — declare before the run

Set the bar *before* looking: the comparison is meaningful only if (a) N ≥ a minimum tasks completed end-to-end, (b) the two arms disagree non-trivially on top-k (`rank_correlation` < threshold on a meaningful fraction), and (c) outcome signals are non-degenerate (not all-zero). Below that bar the correct output is "insufficient evidence," not a soft confirmation of the favorite.

---

## 3. Tasks

### 3.1 Variant wiring (60 min)

- [ ] `ranking-variants.ts` (§2.1) — register `keyword`/`semantic` arms behind `ContextRanker`; confirm the *only* delta is the ranker.

### 3.2 Dry-run recorder (90 min)

- [ ] Extend `ab_runs` to store per-arm ranking + `rank_method` + the outcome signals of §2.3; assert arm B never writes a served snapshot.

### 3.3 Execute the run (90 min)

- [ ] Run the canonical E2E fixture (Day 27) through both arms on the same corpus; collect N completions.

### 3.4 Compare + recommendation (90 min)

- [ ] `pnpm eval:ab-report --run <id>` — emits §2.3 table + the minimum-evidence check + a Day-30 recommendation line.

### 3.5 Harness validation (45 min)

- [ ] Assert the dry-run guardrails held (arm B never mutated production); if evidence is degenerate, fix the harness/data and re-run rather than shipping a "no signal" as a result.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/evaluation/src/ab/ranking-variants.ts` | Keyword/semantic arms |
| `packages/evaluation/src/ab/outcome-metrics.ts` | §2.3 outcome signals |
| `packages/evaluation/src/ab/ab-report.ts` | Comparison + recommendation CLI |
| `docs/retros/week6-ab-results.md` | Head-to-head results |

---

## 5. Acceptance Criteria

- [ ] The harness runs the canonical fixture under both arms; the *only* differing step is the context ranker.
- [ ] Arm B's ranking is recorded in the harness, never written to a served `ContextSnapshot` (assertion; production unaffected).
- [ ] `eval:ab-report` emits `context_acceptance_rate`, `human_minutes_per_accept`, `rework_rate`, and `rank_correlation` per arm, plus the §2.4 minimum-evidence verdict.
- [ ] The report includes a one-line Day-30 recommendation (promote / keep shadow / real-A/B) backed by the numbers.
- [ ] `rank_correlation` disagreement is reported as a distribution, not a single scalar.
- [ ] The harness guardrails held: zero production mutations from arm B (grep/assert).
- [ ] `pnpm --filter @harness/evaluation test` green; `pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Vary one thing.** If the arms differ anywhere besides the ranker, the comparison is confounded and the recommendation is noise. The §2.1 "only delta is the ranker" assertion is the day's most important test.
- **Dry-run means arm B must never touch the live path.** A single line that feeds arm B's snapshot to the orchestrator turns a shadow experiment into an un-reviewed production change. The relevant bug is not "wrong ranking," it's "right result, wrong arm" — assert it.
- **Outcome signals beat ranking proxies.** `rank_correlation` tells you the arms differ; `rework_rate`/`human_minutes_per_accept` tell you whether the difference *matters*. A high-disagreement, zero-outcome-difference run is a real (null) result — don't dress it up.
- **Set the evidence bar before looking.** Deciding "N is enough" after seeing a noisy result is how you confirm your priors. Declare minimums (§2.4) and honor "insufficient evidence" as a legitimate output — that's still a finding for Day 30.
- **A broken harness can look like a null result.** Degenerate outcome signals are usually a recording gap, not a finding. Fix the harness before concluding "semantic has no value."
- **Next (Day 30):** Phase 2 → 3 exit review — metrics checkpoint against Phase-1 baseline, the A/B recommendation folded in, Phase-3 backlog, and tag `v0.2.0-harness`.

---

*Prev: [Day 28 — Docs: Specs to v0.3 + Runbook](day-28.md) | Next: [Day 30 — Phase 2→3 Exit Review](day-30.md)*