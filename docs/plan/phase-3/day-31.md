# Day 31 — Learning Pipeline: Review Decisions → Calibration Update (Automated)

| | |
|---|---|
| **Week** | 7 — Close the loop |
| **Spec refs** | Architecture §24.3 (Learning step); Spec 11 (learning loop); Phase-3 README §1, §3 |
| **Estimated effort** | 8h |
| **Prerequisites** | Days 23/25 (weight-fitting), 29/30 (hybrid default), judge signals + `was_useful` log live |

---

## 1. Objectives

By end of day you will have:

1. A **learning pipeline job** that, on a cadence (or threshold), collects new review decisions + `was_useful` + judge signals → refits attention weights → emits a **candidate** for promotion (never auto-applies).
2. The refit is automated end-to-end: trigger from new decision data triggers calibration update, with provenance of *what data* produced *what candidate*.
3. A promotion gate: a candidate only becomes the live default by clearing the A/B guardrail (measured), same discipline as Day 29 — automation extends to *fitting + proposing*, never to unmeasured promotion.
4. The human APPROVE/REJECT gate is untouched — this pipeline tunes **calibration/routing**, not decisions.

This is the core "close the loop" day: Evaluation → Calibration become a running job, not a manual exercise.

---

## 2. Design Decisions

### 2.1 The loop is Evaluate → Calibrate → (measured) Deploy

```
new decisions + was_useful + judge scores
      →  collect window  (scheduler / threshold trigger)
      →  fit candidate weights (Day 23 fitter)
      →  A/B guardrail vs incumbent
      →  PROMOTE (if win) | HOLD (log + retry later)
```

The only new machinery is the **candidate → guardrail → promote** step; fitting already exists (Day 23). The point: this now runs *without a human hand*.

### 2.2 Automation stops at the measured gate

The job may propose; it may **not** promote without a WIN. Auto-promotion on "newer data" alone is precisely the failure the shadow-then-default invariant exists to prevent. `AUTO_APPROVABLE` remains the only auto-decision path (still sampled), and it's unrelated to this job.

### 2.3 Provenance is the audit

Every candidate carries `{ data_window: [decision ids], fit_params, ab_outcome, promoted_at }` — so "why is this weight set live" is answerable months later.

### 2.4 Batch-windowed, not per-decision

Refitting on every single decision is noisy and thrashy. Window the input (e.g. N decisions or T days) and refit when the window closes, with a stale-data floor so the job still runs when volume is low.

---

## 3. Tasks

### 3.1 Data-collection window (60 min)

- [ ] `LearningCollector` — window new decisions + `was_useful` + judge scores.

### 3.2 Fit job (90 min)

- [ ] `CalibrationJob.run()` — collect → fit → emit candidate with provenance.

### 3.3 Promotion gate (90 min)

- [ ] Candidate → A/B guardrail vs incumbent → PROMOTE/HOLD; never auto-promote on HOLD.

### 3.4 Scheduler + wiring (60 min)

- [ ] Schedule the job; wire into the loop; expose job status.

### 3.5 Tests (75 min)

- [ ] New data triggers refit; candidate carries provenance; HOLD does not promote; PROMOTE only on WIN; loop leaves APPROVE/REJECT untouched.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/attention-engine/src/learning/collector.ts` | Decision/judge window collector |
| `packages/attention-engine/src/learning/calibration-job.ts` | Fit + propose job |
| `packages/attention-engine/src/learning/promotion-gate.ts` | Guardrail + PROMOTE/HOLD |
| `packages/attention-engine/src/__tests__/learning-loop.test.ts` | Loop tests |

---

## 5. Acceptance Criteria

- [ ] New decision data triggers an automated calibration (fit + candidate).
- [ ] Candidate carries full provenance (window + fit + A/B outcome).
- [ ] HOLD never promotes; PROMOTE requires a measured WIN.
- [ ] APPROVE/REJECT gate untouched by the job.
- [ ] `pnpm --filter @harness/attention-engine test` green.

---

## 6. Notes & Pitfalls

- **"Automated" ≠ "unmeasured".** The loop automates fitting + proposing; promotion stays behind the A/B gate. If you let the job flip defaults on fresh data without WIN, you've recreated the pre-Phase-2 hazard.
- **Window, don't thresh.** Per-decision refits overfit; batch by window/volume and note the stale-data floor.
- **The human gate is out of scope.** This tunes routing/calibration only — it must never stream into APPROVE/REJECT.
- **Day 32:** feedback into context ranking — learn from usefulness.

---

*Next: [Day 32 — Feedback into Context Ranking: Learn from Usefulness](day-32.md)*