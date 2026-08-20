# Day 10 — Promote Spec 10 + Week 2 Metrics Checkpoint

| | |
|---|---|
| **Week** | 2 — Evaluation v0 + Spec 10 |
| **Spec refs** | Architecture §5 (spec-status note: Spec 10 "promoted in Phase 2"), §24.3 (measurement exit criterion), Spec 11 §4/§5 |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Day 09 (A/B harness demo pair); Days 06–07 (metrics + reports) |

---

## 1. Objectives

This is a **checkpoint + promotion** day. Two jobs, no new feature code:

1. **Promote Spec 10 (Observability/Governance)** from "designed in `phase-1/day-22..27`" to a standalone specification in `docs/core/10_Observability_Governance_v0.1.md`, authored from what W1–W2 actually built (identify, spans, metrics, audit, policy).
2. **Lock the Week-2 metric checkpoint** — an offline metrics *report* from the real decision log, plus a working A/B harness that replays a recorded trajectory, both demonstrable before Week 3 touches calibration.

Why Spec 10 promotion is a real deliverable, not a rename: Policy enforcement (auto-approve flag, thresholds, governance alerts) is about to become load-bearing in Week 3. A spec that exists only as Street-Mentions-in-a-plan lets policy drift into "whatever the code says". Writing the standalone spec fixes the contract *before* the feature depends on it.

---

## 2. What Spec 10 must contain (promotion checklist)

| Section | Content | Source (as-built) |
|---------|---------|-------------------|
| Purpose | "Measure and govern the pipeline; every significant operation is observable and attributable." | Architecture §4.4 |
| Identity | `sub`-keyed users, roles, session/JWT | Day 01–02 |
| Observability | OTel spans + `trace_id ↔ correlation_id`; Prometheus metrics | Day 03–04 |
| Metrics | The 10 metric families + their Spec 11 §4 definitions | Day 04 |
| Audit | `event_log.actor_id`, `authz.decision_denied`, append-only reports | Day 02, 07 |
| Governance policy | thresholds, guardrails, auto-approve flag (pointer to Spec 6 §4.1 / Spec 11 §6) | Day 07, pending Day 14 |
| Non-goals | distributed tracing backends, durable schedulers, real-time training | Phase-2 README out-of-scope |

The spec **references** days it came from (traceability in both directions), matching how Spec 8 promotion is handled on Day 24.

---

## 3. Tasks

### 3.1 Draft Spec 10 (120 min)

- [ ] `docs/core/10_Observability_Governance_v0.1.md` — the §2 checklist, cross-linked to Phase-2 day files and Architecture §24.
- [ ] One review pass: does the spec say anything the code doesn't? (If yes, either mark it "(planned, W3)" or remove it — a spec is a contract, not a wishlist.)

### 3.2 Live metrics checkpoint demo (90 min)

- [ ] Run the Week-1 demo + a handful of real approve/reject decisions; `pnpm eval:metrics` over that window; paste real numbers.
- [ ] `pnpm eval:report` produces a persisted report; show `evaluation_reports` has ≥1 row with `source_version`.
- [ ] `pnpm eval:replay --run-id <fixture>` replays with `unmatched === 0`; `pnpm eval:ab …` over the demo pair prints a `go`/`winner`.

### 3.3 Bind specs to reality (60 min)

- [ ] Update Architecture §5's spec-status sentence with a note that Spec 10 now has its own file (v0.1).
- [ ] Update `docs/summary/HAI_overview.md` subsystem table row 10 from "*(Phase 2 standalone)*" to a concrete spec link.

### 3.4 Week-2 retro + CI green (90 min)

- [ ] `docs/retros/week-02.md` — what the metrics say about the pipeline so far, what's still missing (benchmark corpus / gold labels), and what Week 3 must watch.
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green; boundary/architecture tests green.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/core/10_Observability_Governance_v0.1.md` | **Spec 10** (new standalone) |
| `docs/retros/week-02.md` | Week-2 retro |
| Architecture §5 + `HAI_overview.md` (updated) | Spec 10 now linked |
| `evaluation_reports` (populated) | First real persisted report |

---

## 5. Acceptance Criteria

- [ ] `docs/core/10_Observability_Governance_v0.1.md` exists with all seven §2 sections.
- [ ] Spec 10 is referenced from Architecture §5 and `HAI_overview.md` (two cross-links, both directions traceable).
- [ ] `pnpm eval:metrics` prints non-empty precision/recall/leakage gauges for a real window (no all-`undefined` output).
- [ ] `pnpm eval:report` persists a report; `SELECT count(*) FROM evaluation_reports` ≥ 1 with a populated `source_version`.
- [ ] `pnpm eval:replay` replays a fixture with `unmatched === 0`; `pnpm eval:ab` emits a `winner`/`go` for the demo pair.
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` green.
- [ ] No engine imports another engine (architecture test still asserts R4).

**Checkpoint rule:** if the metrics checkpoint can't produce a *real* number from the decision log, stop — do not proceed to calibration (Week 3) on a pipeline you cannot yet measure.

---

## 6. Notes & Pitfalls

- **A promoted spec is a contract; don't write future features into it as if they're built.** Each Spec 10 requirement should be traceable to a shipped day. Where Week 3 will *add* policy (auto-approve, tuned thresholds), label it "(planned, W3)" rather than leaving it ambiguous.
- **Metrics checkpoint is about *real* numbers, not *nonzero* numbers.** An empty `evaluation_reports` with a synthetic fixture is not a checkpoint pass. The demo must run against decisions with real `actor_id`s.
- **Keep the A/B demo pair honest.** The Day-09 demo uses two keyword-weight variants; that's a *proven plumbing* exercise, not a claim about semantic ranking. Say so in the retro — Week 5 will run the real semantic-vs-keyword comparison.
- **Spec 10 must not contradict Spec 11.** Metrics *definitions* live in Spec 11 §4; Spec 10 *governs* them (thresholds, alerts, who-can-change). If you find yourself redefining precision in Spec 10, you've got the boundary wrong.
- **Next (Day 11):** Week 3 begins — extract `was_useful` + assessment + outcome into a calibration dataset.

---

*Prev: [Day 09 — A/B Shadow Harness](day-09.md) | Next: [Day 11 — Calibration Dataset: `was_useful` → Fit Set](day-11.md)*