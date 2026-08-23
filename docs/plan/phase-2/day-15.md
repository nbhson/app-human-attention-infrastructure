# Day 15 — Week 3 Checkpoint: Calibration & Auto-Approve

| | |
|---|---|
| **Week** | W3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §4.1 (alert fatigue), Spec 11 §6 (calibration gates auto-approve), Spec 1 §24.3 (weights fitted from real data) |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 11–14 (dataset, fit, thresholds, auto-approve flag) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. By end of day you will have:

1. A **before/after calibration demo** — placeholder weights vs fitted weights measured on the held-out validation set, with the honest verdict stated plainly (including "fitted did not beat placeholder").
2. A **gated auto-approve demo** — the gate shown working: with calibration red, the flag cannot go live; the kill-switch and sampling audit are demonstrated as mechanisms.
3. A **Week-3 retrospective** stating whether calibration actually improved routing numbers, and what that implies for Week 4.

**Do not leave Week 3 with auto-approve live.** The flag ships **disabled**; only the mechanism is demonstrated, and the kill-switch is shown working.

---

## 2. What Week 3 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Calibration dataset (`was_useful` + outcome → fit set) | `@harness/evaluation` | ✅ Day 11 |
| Weight fitting (train/validation, before/after) | `@harness/evaluation` + `@harness/attention-engine` | ✅ Day 12 |
| Adaptive thresholds + budget + inflation monitor | `@harness/attention-engine` | ✅ Day 13 |
| Auto-approve flag + kill-switch + sampling audit (gated) | `@harness/attention-engine` | ✅ Day 14 |

---

## 3. Tasks

### 3.1 Before/after calibration demo (90 min)
`scripts/demo/week3-calibration.md`:
1. `pnpm eval:make-dataset --label outcome` over the live decision log → row count + class balance.
2. `pnpm eval:fit --dataset <id>` → the before/after table: placeholder vs fitted `log_loss` + `ranking_accuracy`.
3. Show the fitted weight vector and the inflation gauge — and state the verdict.

> **Recorded outcome (Phase 2):** the fit produced `log_loss_fitted 0.316` vs placeholder `0.262` — **not an improvement** — so `StaticWeightsAdapter` stays active and `eval:fit` printed `improvement: false`. This is the honest "no win" the checkpoint must state, not dress up.

### 3.2 Auto-approve demo (60 min)
1. Show the gate: with calibration red (Day 12 non-win), `POST /api/admin/auto-approve:enabled` is refused by the calibration precondition (governance denial logged).
2. In a test harness with calibration *forced* green, run a LOW-risk item → `AUTO_APPROVED` decision, `actor_id IS NULL`, `sample` recorded.
3. `POST /api/admin/auto-approve/kill` → in-flight `AUTO_APPROVABLE` item requeues to human; next attempt denied.

### 3.3 Week-3 retro (60 min)
`docs/retros/week-03.md` — the honest answer: did fitting beat the placeholders on real data, by how much, and is the improvement large enough to trust? Also note what would make Week 4's semantic shadow *measurable*.

### 3.4 Green the gate + reset flags (up to 2h)
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green.
- [ ] Verify auto-approve is **disabled** at end of day (flag off, kill-switch armed) — leave the system in its safe default.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo/week3-calibration.md` | Before/after + auto-approve demo |
| `docs/retros/week-03.md` | Week-3 retro |
| `README.md` / `wiring-map.md` (updated) | Week-3 status |

---

## 5. Acceptance Criteria

- [ ] Before/after demo shows real `log_loss`/`ranking_accuracy` for placeholder vs fitted — and states the verdict (no win → placeholder kept).
- [ ] Auto-approve demo records an `AUTO_APPROVED` row with `actor_id IS NULL` and `sample` populated (in the forced-green harness only).
- [ ] Kill-switch demo: in-flight item requeued; a subsequent attempt denied.
- [ ] At end of day, `auto_approve_enabled = false` and `auto_approve_kill_switch.enabled = true`.
- [ ] Week-3 retro states, in one line, whether calibration improved routing and cites the numbers (the honest answer: no, `0.316` vs `0.262`).
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green; no engine imports another engine.

---

## 6. Notes & Pitfalls

- **"Improvement" must be measured, not asserted.** If fitted weights don't beat placeholders, say so and keep the placeholders. A checkpoint that ships a regression dressed as progress is worse than a red checkpoint.
- **Auto-approve ships OFF.** The demo proves the mechanism; it does not put the system into auto-approve for real traffic.
- **Sampling audit is a canary, not a safety net.** A 10% sample catching leakage means ~90% of auto-approvals are unaudited — state the residual risk.
- **The A/B seam is unblocked for Week 4.** The Day-09 harness can compare keyword vs semantic ranking once the Week-4 index exists.
- **Next (Day 16):** Week 4 — pgvector + `Embedder` interface + provider adapter, the shadow semantic infrastructure.

---

*Prev: [Day 14 — Auto-Approve: Flag, Kill-Switch & Sampling Audit](day-14.md) | Next: [Day 16 — pgvector Migration, `Embedder` Interface & Provider Adapter](day-16.md)*