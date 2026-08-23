# Day 29 — Hybrid Default Cutover; A/B vs Shadow Baseline

| | |
|---|---|
| **Week** | 6 — Hybrid context default |
| **Spec refs** | Architecture §7 (shadow-then-default invariant); Phase-3 README §8.4 ("each new default is won") |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 26–28 (hybrid + re-rank + RAG Fusion); Phase-2 A/B shadow harness (`eval:ab-report`) |

---

## 1. Objectives

By end of day you will have:

1. A **measured A/B** — hybrid (BM25+embeddings+RRF+re-rank) vs the phase-2 keyword/shadow baseline — over a shared corpus (recorded reviews), producing a head-to-head verdict.
2. The **gated cutover**: hybrid becomes the default `rank_method` **only if it wins** the measured comparison; on HOLD it stays `keyword`.
3. A recorded cutover decision with the A/B numbers and a guardrail check.
4. The old shadow baseline retired only where the hybrid has cleanly displaced it.

This is the "defaults are won, not inherited" day — the measured comparison *is* the gate.

---

## 2. Design Decisions

### 2.1 Reuse the Phase-2 A/B harness

`AbHarness` replays recorded reviews through both variants and `compare` produces a tau-style rank-correlation verdict with a guardrail. Hybrid is `PipelineVariant('hybrid')`; baseline is `PipelineVariant('keyword')` (the incumbent default). No new machinery — the discipline already exists.

### 2.2 The verdict is binary and explicit

`WIN → rank_method default = hybrid`; `HOLD → default stays keyword`, hybrid remains selectable, investigation is logged. Partial wins (better on one metric) are documented but do **not** flip the default — the default flips on the agreed primary metric winning.

### 2.3 Cutover is a config change, not a code rewrite

Flipping the default is one resolved value (`rank_method` default). Reversible in seconds; the A/B report + decision are the audit trail for why.

### 2.4 Shadow→default cleanup is Day 30

If hybrid wins, today flips the default; Day 30 removes the shadow comparison scaffolding cleanly and re-checks the guardrail. Don't rip out shadowing while the ink is wet.

---

## 3. Tasks

### 3.1 A/B setup (90 min)

- [ ] Define hybrid + keyword variants; assemble the shared replay corpus (recorded reviews).

### 3.2 Run the comparison (90 min)

- [ ] `eval:ab-report` over the corpus; capture the verdict + guardrail.

### 3.3 Gated flip (60 min)

- [ ] On WIN: set `rank_method` default → `hybrid` (config seam); on HOLD: no flip + log investigation.

### 3.4 Decision record (45 min)

- [ ] Persist the cutover decision + numbers (`docs/retros/` or a decision log).

### 3.5 Tests/checks (45 min)

- [ ] Both variants runnable; default reflects the measured decision; guardrail honored.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/evaluation/src/ab/…` (updated) | Hybrid vs keyword variants |
| `packages/context-engine/src/retrieval/retriever-factory.ts` (updated) | Default flip (gated) |
| `docs/retros/phase3-w6-cutover.md` | A/B numbers + decision |

---

## 5. Acceptance Criteria

- [ ] A/B harness runs hybrid vs keyword over the corpus and emits a verdict + guardrail result.
- [ ] Default flips to `hybrid` **only** on a measured WIN; HOLD leaves `keyword` default.
- [ ] The cutover decision + numbers are recorded and reproducible.
- [ ] No default flip without the measured comparison.
- [ ] `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **The gate is the measurement.** If the harness can't produce a clean verdict (insufficient corpus, ambiguous correlation), the correct answer is HOLD + fix the measurement — not "flip and see".
- **Primary metric pre-agreed.** Decide *before* running what counts as WIN (e.g. routing-precision uplift with guardrail); changing the metric after seeing numbers is p-hacking.
- **Cutover is reversible.** Keep `keyword` selectable in production for a kill-switch rollout window.
- **Day 30** checkpoint: hybrid default, shadow→default clean.

---

*Next: [Day 30 — Week 6 Checkpoint: Hybrid Default; Shadow→Default Clean](day-30.md)*