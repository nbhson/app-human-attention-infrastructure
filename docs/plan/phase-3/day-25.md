# Day 25 — Week 5 Checkpoint: Judge + Calibration Run End-to-end

| | |
|---|---|
| **Week** | 5 — Review-quality calibration |
| **Spec refs** | Phase-3 README §5 (W5 milestone), §7 (judge exit criteria) |
| **Estimated effort** | 5h |
| **Prerequisites** | Days 21–24 (judge, agreement, weight-fitting, gold corpus) |

---

## 1. Objectives

By end of day you will have:

1. A demonstrable Week-5 milestone: **run the judge + calibration end-to-end** — judge a review report, compute inter-judge agreement + judge-vs-gold agreement, refit attention weights with judge signals, and report an A/B verdict against the incumbent.
2. A calibration report (`scripts/calibration-report.ts` or evaluation report page) surfacing agreement numbers + the A/B outcome + the promotion decision (promote or hold).
3. Integration debt closed: audit rows reproducible, corpus versions consistent, candidate weights runnable.
4. W5 evidence in `docs/retros/`; a decision recorded (promote/hold) by the measurement, never by fiat.

The checkpoint closes the review-quality loop: measure → fit → compare → decide.

---

## 2. Design Decisions

### 2.1 The checkpoint output is a *decision*, not just numbers

The demo ends with an explicit **PROMOTE / HOLD** verdict from the A/B harness (tau-style comparison, Phase-2 machinery) plus the agreement metrics. If the candidate doesn't beat the incumbent, the verdict is HOLD — and that's a *successful* checkpoint (the gate worked).

### 2.2 Three agreements, one report

Surface (1) inter-judge agreement (Day 22), (2) judge-vs-gold agreement (Day 24), and (3) the weight-fit uplift (Day 23) together — quality of judge, quality of gold, quality of fit, each with provenance.

### 2.3 Read the milestone literally

W5 = "LLM-as-judge on reports (severity/routing agreement); `was_useful` → weight fitting." Demonstrable means a *human can watch* these three numbers come out of one run with source data behind each.

---

## 3. Tasks

### 3.1 End-to-end calibration run (90 min)

- [ ] `scripts/calibration-report.ts` — corpus → judge → agreement → refit → A/B → report.

### 3.2 Report surface (45 min)

- [ ] Render agreement + A/B verdict + promote/hold decision (CLI or report page).

### 3.3 Integration debt pass (60 min)

- [ ] Audit recomputation verified; corpus version consistency; candidate weight variant loads clean.

### 3.4 Evidence + decision record (45 min)

- [ ] `docs/retros/phase3-w5.md` — numbers + the promote/hold decision.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/calibration-report.ts` | Judge + calibration end-to-end report |
| `packages/evaluation/src/report/…` (updated) | Calibration report generator |
| `docs/retros/phase3-w5.md` | Week 5 checkpoint evidence + decision |

---

## 5. Acceptance Criteria

- [ ] `pnpm calibration:report` runs corpus → judge → agreement → refit → A/B end-to-end.
- [ ] Inter-judge and judge-vs-gold agreement numbers are printed with provenance.
- [ ] A/B harness emits a definitive PROMOTE/HOLD verdict for the candidate weights.
- [ ] Every number recomputes from audit rows.
- [ ] `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **HOLD is a valid, successful result.** The discipline isn't "promote"; it's "the measurement decides". Logging a HOLD with clean evidence is the checkpoint done right.
- **Provenance on every number.** A headline agreement figure without the run ids/report hashes behind it can't be defended in the Day 39 regression — wire provenance now.
- **Week 6 pivots to hybrid context default** — judge/benchmark now feed calibration; don't refactor them mid-phase.
- **Next (Day 26):** hybrid retriever default — BM25 + embeddings fused.

---

*Next: [Day 26 — Hybrid Retriever Default: BM25 + Embeddings Fused](day-26.md)*