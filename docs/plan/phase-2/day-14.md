# Day 14 — Auto-Approve: Flag, Kill-Switch & Sampling Audit

| | |
|---|---|
| **Week** | W3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §2.2 (`auto_approve_enabled` / `auto_approve_max_risk`), §4 (AUTO-APPROVE decision path), Spec 11 §6 (auto-approve gating) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 13 (adaptive thresholds + inflation monitor); Day 12 (weights via `WeightsProvider`); Day 02 (ADMIN role) |

---

## 1. Objectives

By end of day you will have:

1. The **`AUTO_APPROVABLE` path actually acted on** — when a change's assessment clears the policy (`auto_approve_max_risk`) *and* the calibration gate *and* the flag is on, the pipeline approves without a human, recording exactly why.
2. A **feature flag** (`auto_approve.enabled`), gated on **calibration success** — the flag is inactive until the before/after evidence (Day 12 fit + Day 13 monitors) is green.
3. A **kill-switch** that in one flip disables auto-approve *and* re-opens every in-flight auto-approve to human review.
4. A **sampling audit** — a fixed fraction of auto-approves is *also* routed to a human as a silent control; a human reject is an `escalation_leakage` event.

This is the highest-stakes flag in Phase 2. Everything here is defensive-by-construction: never on by default, always auditable, always reversible. **The calibration gate is the point** — and it is the honest reason the flag must ship OFF (see §2.1 and §6).

---

## 2. Design Decisions

### 2.1 The gate order — calibration evidence before the flag

Auto-approve eligibility is a **three-part AND**, evaluated in order:

1. **Calibration is green** — a `calibration_weights` row exists with `log_loss_fitted < log_loss_placeholder` and `ranking_accuracy_fitted ≥ ranking_accuracy_placeholder` (Day 12), and the inflation monitor is below 30% (Day 13).
2. **The flag is on** — `AttentionPolicy.autoApproveEnabled` (Spec 6 §2.2), set by an ADMIN through a guarded endpoint.
3. **The item clears the bar** — `combined_priority < auto_approve_max_risk` AND no `ALWAYS_REVIEW` policy rule matches.

If (1) is false, auto-approve is *structurally* off regardless of the flag — a flipped flag with red calibration logs a governance denial, not an approval.

> **Recorded outcome (Phase 2):** gate (1) is **red** — the Day-12 fit lost to the placeholder (`0.316` vs `0.262`). Therefore the flag ships OFF at rest and the auto-approve path is never live this phase. That is the correct, measured result: the mechanism exists and is testable, but calibration evidence is the precondition it has not yet met.

### 2.2 Kill-switch — one row, immediate, in-flight-safe

```sql
-- packages/db/migrations/0109_auto_approve.sql
ALTER TABLE attention_policies ADD COLUMN auto_approve_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE attention_policies ADD COLUMN auto_approve_max_risk double precision NOT NULL DEFAULT 0.20;
CREATE TABLE auto_approve_kill_switch (
  id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true,
  killed_at timestamptz, killed_by text REFERENCES users(id), reason text,
  created_at timestamptz NOT NULL DEFAULT now());
```

The kill-switch is a **single row**; the path checks it on every decision. Killing it also enqueues every in-flight `AUTO_APPROVABLE` item back to the human queue. "In one flip" is literal.

### 2.3 Sampling audit — a silent control

On each auto-approve, with probability `audit_sample_rate` (default 0.10), **also** route the item to a human *without telling them it was auto-approved*. A sampling human reject emits `evaluation.escalation_leakage` (Spec 11 §4.1).

### 2.4 The approval record — "who/what/why" even without a human

```text
review_decisions.row:
  decision    = 'AUTO_APPROVED'
  actor_id    = NULL                 -- no human acted
  auto_approve = { flag_version, calibration_dataset_id, sample }
  rationale   = "Auto-approved: priority < max_risk, calibration green (dataset id)"
```

`AUTO_APPROVED` is a **new decision value** (distinct from `OVERRIDDEN`/`APPROVED`) so metrics and the A/B harness can tell a machine decision from a human one.

---

## 3. Tasks

### 3.1 Migration + policy columns (45 min)
- [ ] Migration `0109_auto_approve.sql` + `AUTO_APPROVED` in the `decision` CHECK.

### 3.2 Calibration-gate evaluator (75 min)
- [ ] `packages/attention-engine/src/auto-approve/gate.ts` — evaluate §2.1's three-part AND; return a structured reason on any failure.
- [ ] Gate state sourced from `calibration_weights` (latest) + inflation gauge + flag + policy.

### 3.3 Auto-approve executor + kill-switch (120 min)
- [ ] `packages/attention-engine/src/auto-approve/executor.ts` — on `AUTO_APPROVABLE`, check gate + kill-switch → write `AUTO_APPROVED` → drive `AWAITING_REVIEW → APPROVED → COMPLETED`.
- [ ] `kill-switch.ts` + `POST /api/admin/auto-approve/kill` (ADMIN); `POST /api/admin/auto-approve:enabled` (ADMIN).

### 3.4 Sampling audit (90 min)
- [ ] `packages/attention-engine/src/auto-approve/sampler.ts` — probability router; duplicate item to human with a `sampled` marker; human reject → `evaluation.escalation_leakage`.

### 3.5 Tests (150 min)
- [ ] Gate: flag on + calibration red → no auto-approve (governance denial logged).
- [ ] Gate: flag off + calibration green → no auto-approve.
- [ ] Gate: both green + priority under bar → `AUTO_APPROVED` with the §2.4 record.
- [ ] `ALWAYS_REVIEW` path → never auto-approves.
- [ ] Kill-switch: one flip → in-flight item requeues; subsequent attempts denied.
- [ ] Sampler: `audit_sample_rate=1.0` → every auto-approve also routed to human; a reject → `evaluation.escalation_leakage`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0109_auto_approve.sql` | policy columns + kill-switch + decision value |
| `packages/attention-engine/src/auto-approve/{gate,executor,kill-switch,sampler}.ts` | The auto-approve path |
| `apps/api/src/routes/admin.ts` | flag + kill-switch endpoints (ADMIN) |
| `packages/attention-engine/src/__tests__/auto-approve.test.ts` | §3.5 matrix |

---

## 5. Acceptance Criteria

- [ ] Auto-approve is **off by default**: fresh DB has `auto_approve_enabled = false` and `auto_approve_kill_switch.enabled = true`.
- [ ] The three-part AND gate: each failing case independently blocks auto-approve (three tests).
- [ ] An `ALWAYS_REVIEW` path can never be auto-approved.
- [ ] `AUTO_APPROVED` writes the §2.4 record with `dataset_id` + `sample`; `actor_id IS NULL`.
- [ ] Kill-switch: one flip → in-flight item requeued, new attempts denied.
- [ ] `audit_sample_rate = 1.0` → sampled reject emits `evaluation.escalation_leakage`.
- [ ] `POST /api/admin/auto-approve/*` returns 403 for REVIEWER, 200 for ADMIN.
- [ ] The **calibration-red** case is the live default: with the Day-12 non-win, the flag is OFF and the path refuses to instrument itself — asserted.

---

## 6. Notes & Pitfalls

- **The flag is the *last* gate, not the only one.** Calibration-red must block even when the flag is on — otherwise a red fit becomes confidence-without-evidence by the back door.
- **Kill-switch must affect *in-flight* items, not just future ones.** Requeue, don't trust "the next run will check".
- **The sampler must be silent to the reviewer.** The `sampled` marker lives only on the backend row, never in the UI payload.
- **`AUTO_APPROVED ≠ APPROVED`.** A new decision value ripples into downstream metrics; update the Day-06 labeler to treat `AUTO_APPROVED` as its own class.
- **`actor_id IS NULL` is a feature here.** "No human acted" is the *point* — don't let the Day-02 "no null actors" instinct scrub it.
- **Calibration-gated means it stays OFF until the fit earns it.** The honest Phase-2 state is: mechanism built, flag OFF, kill-switch armed — because gate (1) is red. That is the intended behavior, not a defect.
- **Next (Day 15):** Week-3 checkpoint — the before/after calibration demo and the auto-approve flag demonstrated under sampling audit, with the honest "not improved" verdict.

---

*Prev: [Day 13 — Adaptive Thresholds & Alert-Fatigue Monitor (Spec 6 §4.1)](day-13.md) | Next: [Day 15 — Week 3 Checkpoint: Calibration & Auto-Approve](day-15.md)*