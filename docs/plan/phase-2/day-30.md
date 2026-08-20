# Day 30 — Phase 2 → 3 Exit Review, Metrics Checkpoint & `v0.2.0-harness` Tag

| | |
|---|---|
| **Week** | 6 — Harden + exit review |
| **Spec refs** | Spec 1 §24.3 (Phase 2→3 exit criteria), Spec 11 §4 (pipeline quality), Spec 10 (governance); Phase-2 README §7 |
| **Estimated effort** | 5 hours |
| **Prerequisites** | Days 1–29 complete; Week-6 A/B results (Day 29) |

---

## 1. Objectives

This is the **exit review**, not a build day. By end of day you will have:

1. A **metrics checkpoint** — the Phase-2 numbers against the Phase-1 baseline, measured (never asserted), for every §7 exit criterion.
2. A **go/no-go decision** for the Phase 2 → 3 transition, stated with the evidence, plus a **Phase-3 backlog** of everything explicitly out of scope for Phase 2 (hybrid semantic default, memory/evidence subsystem, targeted verification, multi-agent loops, LLM-as-judge) promoted to concrete backlog items.
3. The **`v0.2.0-harness` tag** cut — but *only* if go; a red exit review does not tag.
4. A **Week-6 + phase retrospective** — the honest record of what held, what drifted, and what Phase 3 must watch.

Day 30 is the answer to the single question Phase 2 existed to ask: *is the loop closed?*

---

## 2. What To Verify Today

Phase-2 README §7 is the checklist. Each line below is the *evidence* that satisfies it:

| §7 Exit criterion | Evidence source (day) | Verifiable as |
|-------------------|----------------------|---------------|
| Routing precision/recall computed & reviewed | Days 6–7 + Day 27 | `evaluation_reports` rows + reference run |
| Attention weights fitted from `was_useful`; inflation improved | Days 11–12 + Day 15 | before/after `log_loss`/`ranking_accuracy` |
| A/B harness replays + head-to-head, no production effect | Days 8–9 + Day 29 | `ab_runs` + zero-mutation assertion |
| Semantic infra shadow-only; `rank_method` default `keyword` | Days 16–18 + Day 25 | grep + report invariant |
| SSO/OIDC + roles; identity on audit | Days 1–2 | `review_decisions.actor_id` non-null |
| Auto-approve gated: flag + sampling audit + calibration | Days 13–14 + Day 15 | flag OFF at rest, kill-switch armed |
| Spec 8 + Spec 10 promoted | Days 24 + 10 | `docs/core/8_*`, `10_*` exist |
| Sandbox verifiable; large artifacts via `ContentStore` | Days 21–23 + Day 27 | `verification_reports.sandbox=true`, object refs |
| `pnpm test && pnpm lint && pnpm e2e` green | full phase | CI gate green |

---

## 3. Tasks

### 3.1 Metrics checkpoint (90 min)

- [ ] Pull the Phase-1 baseline (commit/tag `v0.1.0-harness`) and the Phase-2 numbers into `docs/retros/phase2-metrics.md`: routing precision/recall, attention efficiency, dwell, cache hit rate, sandbox fallback rate, A/B recommendation (Day 29).
- [ ] Mark each §7 criterion ✓/✗ with its number.

### 3.2 Go/no-go + Phase-3 backlog (60 min)

- [ ] Write the decision (go / no-go / go-with-caveats) with the one paragraph of evidence. No-go = fix list, no tag today.
- [ ] `docs/plan/phase-3/backlog.md` — promote the §2 "explicitly out of scope" items to backlog (each with the seam it plugs into and the gate it must re-run).

### 3.3 Tag (30 min)

- [ ] If go: `git tag v0.2.0-harness` on the reviewed commit; verify `git show` builds + tests green from the tag.

### 3.4 Week-6 + phase retro (60 min)

- [ ] `docs/retros/week-06.md` — what held, what drifted, what Phase 3 must watch (semantic-shadow leakage, sandbox latency, fallback-rate drift, A/B null result if Day 29 found one).

### 3.5 Close-out (60 min)

- [ ] Verify no subsystem left in a non-default state (auto-approve OFF, semantic shadow OFF, in-process parity armed); update `wiring-map.md` + README status to "Phase 2 complete".

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/retros/phase2-metrics.md` | Baseline vs Phase-2 checkpoint |
| `docs/retros/week-06.md` | Week-6 + phase retro |
| `docs/plan/phase-3/backlog.md` | Phase-3 backlog |
| `git tag v0.2.0-harness` | Release tag (go only) |

---

## 5. Acceptance Criteria

- [ ] Every §7 exit criterion is marked ✓/✗ with a cited number (no "not-checked" rows).
- [ ] The go/no-go decision is written with evidence; a no-go produces a fix list and no tag.
- [ ] `phase2-metrics.md` compares each metric against the *Phase-1 baseline*, not against nothing.
- [ ] `phase-3/backlog.md` lists each out-of-scope item with its seam + re-run gate.
- [ ] If go: `git tag v0.2.0-harness` exists and `git show v0.2.0-harness` passes `pnpm test && pnpm lint`.
- [ ] System left in safe defaults (auto-approve OFF, semantic shadow OFF, in-process parity armed).
- [ ] Week-6 retro names at least one thing Phase 3 must watch, citing a number.

---

## 6. Notes & Pitfalls

- **Do not tag a red review.** A tag on a red exit review converts "we didn't finish" into "we shipped v0.2.0", and every downstream assumption (Phase 3 building on a measured loop) quietly inherits an unmeasured one. No-go is a legitimate, valuable outcome — record it, don't paper it over with a tag.
- **"Measured" means against a baseline, not in a vacuum.** A routing-recall number without the Phase-1 number it improved on proves nothing. If the baseline was never recorded, that itself is a finding worth carrying into Phase 3.
- **The Phase-3 backlog is the *contract* for the next phase, not a wishlist.** Each item must name the seam it plugs into and the gate it re-runs; otherwise Phase 3 inherits a pile of "we should probably" items with no acceptance shape.
- **Leave the system in its safe defaults.** Auto-approve ON or semantic shadow default-ON at close-out is exactly the silent config drift the whole phase was built to make impossible. Verify, don't assume.
- **Semantic shadow was *never* the default — say so as a number, once, finally.** The single most load-bearing fact of the phase (rank_method stayed `keyword`) is the one a future reader will most doubt; the final report should state it flatly, with the grep that proves it.
- **End of Phase 2.** The released artifact is this plan, the specs, and the tag. Do not commit the day files' working tree unless instructed — the tag, if go, is the only git mutation authorized today.

---

*Prev: [Day 29 — A/B Dry-Run End-to-End](day-29.md) | Next: [Phase 3 — Learn & Automate Under Guardrails](../phase-3/README.md)*