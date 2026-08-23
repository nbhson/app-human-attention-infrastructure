# Day 10 — Promote Spec 10 + Week 2 Metrics Checkpoint

| | |
|---|---|
| **Week** | W2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Architecture §5 (Spec 10 "promoted in Phase 2"), §24.3 (measurement exit criterion), Spec 11 §4/§5 |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 09 (A/B harness demo pair); Days 06–07 (metrics + reports) |

---

## 1. Objectives

This is a **checkpoint + promotion** day. Two jobs, no new feature code:

1. **Promote Spec 10 (Observability/Governance)** from "designed in Phase 1" to a standalone spec in `docs/core/10_Observability_Governance_v0.1.md`, authored from what W1–W2 actually built (identity, spans, metrics, audit, policy).
2. **Lock the Week-2 metric checkpoint** — an offline metrics *report* from the real decision log, plus a working A/B harness that replays a recorded review, both demonstrable before Week 3 touches calibration.

Spec 10 promotion is a real deliverable, not a rename: policy enforcement (auto-approve flag, thresholds, governance alerts) becomes load-bearing in Week 3. Writing the standalone spec fixes the contract *before* the feature depends on it.

---

## 2. What Spec 10 must contain (promotion checklist)

| Section | Content | Source (as-built) |
|---------|---------|-------------------|
| Purpose | Measure and govern the pipeline; every significant operation observable and attributable | Architecture §4.4 |
| Identity | `sub`-keyed users, roles, session/JWT | Day 01–02 |
| Observability | OTel spans + `trace_id ↔ correlation_id`; Prometheus metrics | Day 03–04 |
| Metrics | 10 metric families + Spec 11 §4 definitions | Day 04 |
| Audit | `event_log.actor_id`, `authz.decision_denied`, append-only reports | Day 02, 07 |
| Governance policy | thresholds, guardrails, auto-approve flag (pointer to Spec 6 §4.1 / Spec 11 §6) | Day 07, pending Day 14 |
| Non-goals | distributed tracing backends, durable schedulers, real-time training | Phase-2 README out-of-scope |

The spec **references** the days it came from (traceability in both directions), matching how Spec 8 is handled on Day 24.

---

## 3. Tasks

### 3.1 Draft Spec 10 (120 min)
- [ ] `docs/core/10_Observability_Governance_v0.1.md` — the §2 checklist, cross-linked to day files + Architecture §24.
- [ ] One review pass: does it say anything the code doesn't? Mark "(planned, W3)" or remove and mark as such.

### 3.2 Live metrics checkpoint demo (90 min)
- [ ] Run the Week-1 demo + a handful of real approve/reject decisions; `pnpm eval:metrics` over that window; paste real numbers.
- [ ] `pnpm eval:report` persists a report with `source_version`.
- [ ] `pnpm eval:replay --review-id <fixture>` replays with `matched === true`; `pnpm eval:ab` prints a `go`/`winner`.

### 3.3 Bind specs to reality (60 min)
- [ ] Update Architecture §5's spec-status note (Spec 10 now has its own file, v0.1).
- [ ] Update `HAI_overview.md` subsystem table row 10 with a concrete link.

### 3.4 Week-2 retro + CI green (90 min)
- [ ] `docs/retros/week-02.md` — what the metrics say so far, what's missing (benchmark corpus / gold labels), what Week 3 must watch.
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/core/10_Observability_Governance_v0.1.md` | **Spec 10** (new standalone) |
| `docs/retros/week-02.md` | Week-2 retro |
| Architecture §5 + `HAI_overview.md` (updated) | Spec 10 linked |
| `evaluation_reports` (populated) | First real persisted report |

---

## 5. Acceptance Criteria

- [ ] `docs/core/10_Observability_Governance_v0.1.md` exists with all seven §2 sections.
- [ ] Spec 10 referenced from Architecture §5 and `HAI_overview.md` (two cross-links).
- [ ] `pnpm eval:metrics` prints non-empty precision/recall/leakage for a real window (no all-`undefined`).
- [ ] `pnpm eval:report` persists a report; `SELECT count(*) FROM evaluation_reports` ≥ 1 with `source_version`.
- [ ] `pnpm eval:replay` replays a fixture with `matched === true`; `pnpm eval:ab` emits a `winner`/`go`.
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green; no engine imports another engine.

**Checkpoint rule:** if the metrics checkpoint can't produce a *real* number from the decision log, stop — do not proceed to calibration on an unmeasured pipeline.

---

## 6. Notes & Pitfalls

- **A promoted spec is a contract; don't write future features into it as if built.** Where Week 3 will *add* policy (auto-approve, tuned thresholds), label it "(planned, W3)".
- **Metrics checkpoint is about *real* numbers, not *nonzero* numbers.** The demo must run against decisions with real `actor_id`s.
- **Keep the A/B demo pair honest.** Two keyword-weight variants is a *plumbing* exercise, not a claim about semantic ranking. Say so in the retro.
- **Spec 10 must not contradict Spec 11.** Metrics *definitions* live in Spec 11 §4; Spec 10 *governs* them (thresholds, alerts, who-can-change).
- **Next (Day 11):** extract `was_useful` + assessment + outcome into a calibration dataset.

---

*Prev: [Day 09 — A/B Shadow Harness: Side-by-Side Review-Routing Variants](day-09.md) | Next: [Day 11 — Calibration Dataset: Extract `was_useful` → Fit Set](day-11.md)*