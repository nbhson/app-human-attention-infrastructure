# Day 15 — Week 3 Checkpoint: Calibration & Auto-Approve

| | |
|---|---|
| **Week** | 3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §4.1 (alert fatigue), Spec 11 §6 (calibration gates auto-approve), Spec 1 §24.3 (weights fitted from real data) |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Days 11–14 (dataset, fit, thresholds, auto-approve flag) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. By end of day you will have:

1. A **before/after calibration demo** — placeholder weights vs fitted weights, measured on the held-out validation set, with the adaptive thresholds and inflation monitor showing improvement (or honestly not).
2. A **gated auto-approve demo** — flag on behind sampling audit, kill-switch flipped live, in-flight item re-opened to human.
3. A **Week-3 retrospective** that states plainly whether calibration actually improved the routing numbers, and what that implies for the Week-4 semantic work.

**Do not leave Week 3 with auto-approve live in any non-demo environment.** The flag ships **disabled**; only the demo flips it, under sampling audit, and the kill-switch is shown working.

---

## 2. What Week 3 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Calibration dataset (`was_useful` + outcome → fit set) | `@harness/evaluation` | ✅ Day 11 |
| Weight fitting (train/validation, before/after) | `@harness/evaluation` + `@harness/attention-engine` | ✅ Day 12 |
| Adaptive thresholds + budget + inflation monitor | `@harness/attention-engine` | ✅ Day 13 |
| Auto-approve flag + kill-switch + sampling audit | `@harness/attention-engine` | ✅ Day 14 |

---

## 3. Tasks

### 3.1 Before/after calibration demo (90 min)

`scripts/demo/week3-calibration.md`:
1. `pnpm eval:make-dataset --label outcome` over the live decision log → show `row_count` + class balance.
2. `pnpm eval:fit --dataset <id>` → show the before/after table: placeholder vs fitted `log_loss` + `ranking_accuracy` on the held-out set.
3. Show the fitted weight vector and the inflation gauge before/after reweighting.

### 3.2 Auto-approve demo (60 min)

1. `POST /api/admin/auto-approve:enabled` (ADMIN) with calibration already green → auto-approve activates.
2. Run a LOW-risk item through: `AUTO_APPROVED` decision, `actor_id IS NULL`, `sample` recorded.
3. `POST /api/admin/auto-approve/kill` → in-flight `AUTO_APPROVABLE` item requeues to human; next auto-approve attempt denied with a governance reason.

### 3.3 Week-3 retro (60 min)

`docs/retros/week-03.md` — the honest answer to: did fitting beat the placeholders on real data, by how much, and is the improvement large enough to trust? Also: what would make Week 4's semantic shadow *measurable* (the A/B harness seam is ready, are the metrics the right comparison basis?).

### 3.4 Green the gate + reset flags (up to 2h)

- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green.
- [ ] Verify auto-approve is **disabled** at the end of the day (flag off, kill-switch armed) — leave the system in its safe default state.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo/week3-calibration.md` | Before/after + auto-approve demo script |
| `docs/retros/week-03.md` | Week-3 retro |
| `README.md` / `wiring-map.md` (updated) | Week-3 status |

---

## 5. Acceptance Criteria

- [ ] Before/after fit demo shows real `log_loss`/`ranking_accuracy` numbers for placeholder vs fitted (not placeholder-vs-placeholder).
- [ ] Auto-approve demo records an `AUTO_APPROVED` row with `actor_id IS NULL` and `sample` populated.
- [ ] Kill-switch demo: in-flight item requeued to human; a subsequent auto-approve attempt is denied.
- [ ] At end of day, `auto_approve_enabled = false` and `auto_approve_kill_switch.enabled = true` (safe default restored).
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green.
- [ ] No engine imports another engine (architecture test green).
- [ ] Week-3 retro states, in one line, whether calibration improved routing and cites the numbers.

---

## 6. Notes & Pitfalls

- **"Improvement" must be measured, not asserted.** If fitted weights don't beat placeholders on the held-out set, say so and keep the placeholders. A checkpoint that ships a regression dressed as progress is worse than a red checkpoint.
- **Auto-approve ships OFF.** The demo proves the path; it does not put the system into auto-approve for real traffic. Leaving the flag on "because it passed the demo" is a checklist violation of the highest order.
- **Sampling audit is your canary, not your safety net.** A 10% sample catching a leakage signal means ~90% of auto-approvals are unaudited. State the residual risk in the retro rather than implying the sampler covers everything.
- **The A/B seam is now unblocked for Week 4.** Note in the retro that the Day-09 harness can compare keyword vs semantic ranking once the Week-4 index exists — nothing should be built to make that comparison *except* the semantic ranker itself.
- **Next (Day 16):** Week 4 — pgvector + `Embedder` interface + provider adapter, the shadow semantic infrastructure.

---

*Prev: [Day 14 — Auto-Approve: Flag, Kill-Switch & Sampling Audit](day-14.md) | Next: [Day 16 — pgvector Migration, `Embedder` Interface & Provider Adapter](day-16.md)*