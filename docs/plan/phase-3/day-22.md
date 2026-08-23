# Day 22 — Inter-judge Agreement + Audit Trail

| | |
|---|---|
| **Week** | 5 — Review-quality calibration |
| **Spec refs** | Spec 11 §5.1 (audited judge, agreement); Phase-3 README §7 (demonstrated inter-judge agreement) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 21 (`Judge` + `judge_runs` + rubric) |

---

## 1. Objectives

By end of day you will have:

1. **Inter-judge agreement** — a statistic quantifying how much the judge's severity/routing scores agree with an independent signal (a second judge call with a different temp/provider, or a human gold label): e.g. Cohen's/weighted κ or raw agreement rate per dimension.
2. An **audit trail** — every judge run and agreement computation is append-only and reproducible (input report hash, prompt version, model, temperature, scores).
3. An agreement report generator writing `judge_agreement` rows/metrics the Week 5 checkpoint will surface.
4. A fixture pair (two judges on N reports) producing a real agreement number.

This makes judge quality itself measurable — "the judge is good" must be demonstrable, not assumed.

---

## 2. Design Decisions

### 2.1 Agreement is per-dimension

Severity and routing may disagree at different rates — report `severityAgreement`.κ and `routingAgreement`.κ separately, plus an `overall` agreement. A single collapsed number hides where the judge drifts.

### 2.2 Reproducibility over convenience

Each run stores `report_hash` (canonical report), `prompt_version`, `model`, `temperature`, and scores — so any agreement figure can be recomputed from the audit rows. Append-only; no in-place edits.

### 2.3 Two-judge methodology v0

Shadow agreement: judge a report twice under mildly different conditions (e.g. temperature 0 vs 0.7, or two providers) — self-agreement is a weak but cheap first signal. The stronger signal (judge vs human gold) arrives with Day 24's corpus; today builds the machinery + the weak baseline.

### 2.4 Store the math, not just the verdict

`judge_agreement` rows carry the computed κ/agreement per dimension + the run ids it was computed from, so the checkpoint demo can reconstruct provenance.

---

## 3. Tasks

### 3.1 Agreement computation (90 min)

- [ ] `packages/judge/src/agreement.ts` — κ/agreement per dimension from two score sets.

### 3.2 Second-judge shadow runs (60 min)

- [ ] Run judge twice per fixture report under varying temp; store both `judge_runs`.

### 3.3 Agreement store + report (60 min)

- [ ] `judge_agreement` schema + migration; `AgreementReport` generator.

### 3.4 Audit reproducibility (45 min)

- [ ] `report_hash` + provenance columns; recompute-from-rows test.

### 3.5 Tests (75 min)

- [ ] Agreement math on known score pairs; audit rows append-only; recomputation matches.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/judge/src/agreement.ts` | κ/agreement per dimension |
| `packages/judge/src/agreement-report.ts` | Agreement report generator |
| `packages/db/src/schema/judge.ts` (updated) | `judge_agreement` + provenance columns |
| `packages/judge/src/__tests__/agreement.test.ts` | Agreement + audit tests |

---

## 5. Acceptance Criteria

- [ ] Inter-judge agreement computed per dimension (severity, routing) + overall) from two score sets.
- [ ] `judge_agreement` rows carry the run ids + report hash; append-only.
- [ ] Any agreement figure recomputes from the audit rows.
- [ ] Two-judge shadow run over N fixtures yields a real (non-degenerate) agreement number.
- [ ] `pnpm --filter @harness/judge test` green.

---

## 6. Notes & Pitfalls

- **Self-agreement is the floor, not the answer.** Temp-perturbed agreement measures stability, not truth. The human-gold agreement (Day 24) is the real calibration signal — don't conflate them.
- **Per-dimension, not one scalar.** Routing and severity are different skills for a reviewer; collapse them and you hide a routing drift behind a healthy severity score.
- **Reproducibility is the audit.** If you can't recompute a published agreement number from stored rows, it isn't audited — it's a screenshot.
- **Day 23:** judge signals → attention-weight fitting (`was_useful`).

---

*Next: [Day 23 — Judge Signals → Attention-weight Fitting (`was_useful`)](day-23.md)*