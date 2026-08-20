# Day 14 — Auto-Approve: Flag, Kill-Switch & Sampling Audit

| | |
|---|---|
| **Week** | 3 — Calibrate & gate auto-approve |
| **Spec refs** | Spec 6 §2.2 (`auto_approve_enabled` / `auto_approve_max_risk`), §4 (AUTO-APPROVE decision path), Spec 11 §6 (auto-approve gating) |
| **Estimated effort** | 8 hours |
| **Prerequisites** | Day 13 (adaptive thresholds + inflation monitor green); Day 12 (fitted weights via `WeightsProvider`); Day 02 (ADMIN role) |

---

## 1. Objectives

By end of day you will have:

1. The **`AUTO_APPROVABLE` path actually acted on** — when a change's assessment clears the policy (`auto_approve_max_risk`) and the feature flag is on, the pipeline approves without a human, recording exactly why.
2. A **feature flag** (`auto_approve.enabled`), gated on **calibration success** — the flag is inactive until Week 3's before/after evidence (Day 12 fit + Day 13 monitors) is green.
3. A **kill-switch** that, in one flag flip or one DB row, disables auto-approve *and* re-opens every in-flight auto-approve to human review.
4. A **sampling audit** — of every auto-approve, a fixed fraction is *also* routed to a human as a silent control, and any sampled item the human rejects is an `escalation_leakage` event (Spec 11 §4.1).

This is the highest-stakes flag in Phase 2. The whole system exists to stop "confidence without evidence"; auto-approve is where that principle is most dangerous. Everything here is defensive-by-construction: never on by default, always auditable, always reversible.

---

## 2. Design Decisions

### 2.1 The gate order — calibration evidence before the flag

Auto-approve eligibility is a **three-part AND**, evaluated in order:

1. **Calibration is green** — a `calibration_weights` row exists with `log_loss_fitted < log_loss_placeholder` and `ranking_accuracy_fitted ≥ ranking_accuracy_placeholder` (Day 12), and the inflation monitor is below the 30% ceiling (Day 13).
2. **The flag is on** — `AttentionPolicy.autoApproveEnabled` (Spec 6 §2.2) set by an ADMIN through a guarded endpoint.
3. **The item clears the bar** — `combined_priority < auto_approve_max_risk` AND no `ALWAYS_REVIEW` policy rule matches (Spec 6 §4).

If (1) is false, auto-approve is *structurally* off regardless of the flag — a flipped flag with red calibration logs a governance denial, not an approval.

### 2.2 Kill-switch — one row, immediate, in-flight-safe

```sql
-- packages/db/migrations/0109_auto_approve.sql
ALTER TABLE attention_policies ADD COLUMN auto_approve_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE attention_policies ADD COLUMN auto_approve_max_risk double precision NOT NULL DEFAULT 0.20;

CREATE TABLE auto_approve_kill_switch (
  id           text PRIMARY KEY,               -- UUIDv7
  enabled      boolean NOT NULL DEFAULT true,  -- false = KILLED
  killed_at    timestamptz,
  killed_by    text REFERENCES users(id),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

The kill-switch is a **single row**; the auto-approve path checks it on every decision. Killing it also enqueues every in-flight `AUTO_APPROVABLE` review item back into the human queue (state `QUEUED`, `deferred_until` cleared). "In one flip" is literal: one UPDATE, the path is dead, nothing auto-approves again.

### 2.3 Sampling audit — a silent control, not a brown M&M

On each auto-approve, with probability `audit_sample_rate` (default 0.10), **also** route the item to a human reviewer *without telling them it was auto-approved*. If the sampled human rejects it, emit `evaluation.escalation_leakage` (Spec 11 §4.1's "auto-approvable-but-rejected"). The sample rate and every sampled outcome are recorded — the audit is a measured, permanent feature, not a one-off check.

### 2.4 The approval record — "who/what/why" even without a human

An auto-approve still writes a `review_decisions` row with a distinct marker, so the audit trail is unbroken:

```text
review_decisions.row:
  decision      = 'AUTO_APPROVED'
  actor_id      = NULL            -- no human acted
  actor_email   = NULL
  auto_approve = { flag_version, calibration_dataset_id, sample: true|false }
  rationale     = "Auto-approved: priority < ${max_risk}, calibration green (dataset ${id})"
```

`AUTO_APPROVED` is a **new decision value** (distinct from `OVERRIDDEN`/`APPROVED`) so downstream metrics and the A/B harness can tell a machine decision from a human one at a glance.

---

## 3. Tasks

### 3.1 Migration + policy columns (45 min)

- [ ] Migration `0109_auto_approve.sql` (§2.2) + `AUTO_APPROVED` decision value in the `review_decisions.decision` CHECK.

### 3.2 Calibration-gate evaluator (75 min)

- [ ] `packages/attention-engine/src/auto-approve/gate.ts` — evaluate §2.1's three-part AND; return a structured reason when any part fails.
- [ ] Gate state sourced from `calibration_weights` (latest) + inflation gauge + flag + policy.

### 3.3 Auto-approve executor + kill-switch (120 min)

- [ ] `packages/attention-engine/src/auto-approve/executor.ts` — on `AUTO_APPROVABLE`, check gate + kill-switch → write the `AUTO_APPROVED` decision → drive `AWAITING_REVIEW → APPROVED → COMPLETED` (reusing the Day-06 state machine, `triggered_by: 'auto_approve'`).
- [ ] `kill-switch.ts` — the single-row check + the in-flight requeue job; `POST /api/admin/auto-approve/kill` (ADMIN) endpoint.
- [ ] `POST /api/admin/auto-approve:enabled` (ADMIN) for the flag.

### 3.4 Sampling audit (90 min)

- [ ] `packages/attention-engine/src/auto-approve/sampler.ts` — probability router; duplicate item to human queue with a `sampled` marker; on human reject → `evaluation.escalation_leakage`.
- [ ] Record `audit_sample_rate` + outcome on the decision row.

### 3.5 Tests (150 min)

- [ ] Gate: flag on + calibration red → no auto-approve (governance denial logged).
- [ ] Gate: flag off + calibration green → no auto-approve.
- [ ] Gate: both green + priority under bar → AUTO_APPROVED with the §2.4 record.
- [ ] `ALWAYS_REVIEW` policy path matches → never auto-approves regardless of the above.
- [ ] Kill-switch: one flip, an in-flight `AUTO_APPROVABLE` item requeues to human; subsequent auto-approve attempts are denied.
- [ ] Sampler: with `audit_sample_rate=1.0`, every auto-approve also routes to human; a human reject produces `evaluation.escalation_leakage`.

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

- [ ] Auto-approve is **off by default**: a fresh DB has `auto_approve_enabled = false` and a live `auto_approve_kill_switch.enabled = true`.
- [ ] The three-part AND gate is exercised: each of the three failing cases independently blocks auto-approve (three tests).
- [ ] An `ALWAYS_REVIEW` policy path can never be auto-approved.
- [ ] `AUTO_APPROVED` decisions write the §2.4 record with `dataset_id` and `sample`; `actor_id IS NULL`.
- [ ] Kill-switch test: one flip → in-flight item requeued, new auto-approve attempts denied.
- [ ] With `audit_sample_rate = 1.0`, a rejected sampled item emits `evaluation.escalation_leakage`.
- [ ] `POST /api/admin/auto-approve/*` returns 403 for `REVIEWER`, 200 for `ADMIN` (Day-02 guard).
- [ ] `pnpm --filter @harness/attention-engine test` green; `pnpm lint` green; no engine imports another engine.

---

## 6. Notes & Pitfalls

- **The flag is the *last* gate, not the only one.** Calibration-red must block even when the flag is on. A flag that bypasses the evidence gate reintroduces confidence-without-evidence by the back door — the exact bug this system exists to kill.
- **Kill-switch must affect *in-flight* items, not just future ones.** An auto-approve that was computed but not yet completed when the switch flips must be caught. Requeue, don't trust "the next run will check".
- **The sampler must be silent to the reviewer.** If the reviewer knows an item was auto-approved, the control is contaminated. The `sampled` marker lives only on the backend row, never in the UI payload.
- **`AUTO_APPROVED ≠ APPROVED`.** A new decision value is a data-model change that ripples into every downstream metric. Do it once, deliberately (Day 14), and update the Day-06 labeler to treat `AUTO_APPROVED` as its own class — otherwise Week 2's precision numbers silently lump machine and human approvals together.
- **`actor_id IS NULL` is a feature here.** For auto-approve, "no human acted" is the *point*. Don't let the Day-02 "no null actors" reflex scrub it — null actor is the machine-decision marker.
- **Next (Day 15):** Week-3 checkpoint — before/after calibration + the auto-approve flag demonstrated under sampling audit.

---

*Prev: [Day 13 — Adaptive Thresholds & Alert-Fatigue Monitor (Spec 6 §4.1)](day-13.md) | Next: [Day 15 — Week 3 Checkpoint: Calibration & Auto-Approve](day-15.md)*
