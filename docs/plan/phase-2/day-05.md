# Day 05 — Week 1 Checkpoint: Identity & Observability

| | |
|---|---|
| **Week** | W1 — Identity & observability |
| **Spec refs** | Architecture §4.4 + §24.3 (exit criterion: SSO + audit identity), Spec 11 §4 (metrics present), Spec 2 §8 |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 01–04 (auth, authz, OTel, metrics) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A **scripted, live demo** of the Week-1 milestone: SSO login → reviewer role enforced → a real run emitting spans with `trace_id ↔ correlation_id` → metrics on `/metrics`.
2. A **Week-1 retrospective** capturing what's solid, what's fragile, and the decisions Week 2 leans on.
3. A **green CI gate** over the whole Phase-2 stack so far: lint, typecheck, unit + integration, migration, boundaries.

**Do not proceed to Day 06 until every criterion in §5 is green.** Week 2's whole point is to *measure* — measuring with broken identity or half-wired telemetry produces garbage numbers that Week 3 would then "calibrate" against.

---

## 2. What Week 1 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| User identity (`sub`-keyed) + sessions + JWT | `@harness/auth` | ✅ Day 01 |
| Role enforcement + audit identity + `X-Reviewer-Id` retired | `@harness/auth` / `apps/api` | ✅ Day 02 |
| OTel spans + `trace_id ↔ correlation_id` | `@harness/observability` | ✅ Day 03 |
| Prometheus metrics + `/metrics` + dashboards | `@harness/observability` | ✅ Day 04 |

---

## 3. Tasks

### 3.1 Script the live demo (90 min)
`scripts/demo/week1.md` — a narration script with exact commands, run live on a clean stack:

1. **Login:** `/api/auth/login` → mock OIDC redirect → session cookie; `/api/auth/session` returns real `{ sub, roles }`.
2. **AuthZ:** as `OPERATOR`, `POST /api/review/queue/:id/decide` → 403 + `authz.decision_denied`; as `REVIEWER` → 200.
3. **Trace:** one happy-path task; show the root span's `harness.correlation_id` and the `trace_correlation` row.
4. **Metrics:** `curl /metrics` shows `harness_routing_items_total`, `harness_review_dwell_seconds`, `harness_assessment_usefulness_total`.

### 3.2 Week-1 retrospective (60 min)
`docs/retros/week-01.md` — blameless, numbers-first. Questions: is the async-local correlation model holding in the event-handler path? Did removing `X-Reviewer-Id` break Phase-1 tests that hard-coded `reviewer-1`? Is the metric inventory the right shape for Week 3's before/after calibration? Any boundary temptation (an engine reaching for another engine)?

### 3.3 Harden CI + fix all red (up to 2h)
- [ ] `.github/workflows/ci.yml` — add auth + observability to the test matrix; add Postgres + (mock) OIDC service container.
- [ ] `pnpm lint` zero; `pnpm -r typecheck` zero; `pnpm -r test` green (unit + integration).
- [ ] Boundary/architecture test green with R7–R8 in force.

### 3.4 Update wiring map + README (30 min)
- [ ] `docs/architecture/wiring-map.md` — confirm Week-1 registrations (AuthService, SessionService, Tracer, Meter, MetricsRegistry).
- [ ] Root `README.md` — add a "Phase 2 · Week 1" status section.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo/week1.md` | Live demo narration + commands |
| `docs/retros/week-01.md` | Week-1 retrospective |
| `.github/workflows/ci.yml` (updated) | Full Phase-2 gate |
| `docs/architecture/wiring-map.md`, root `README.md` (updated) | Wiring + status |

---

## 5. Acceptance Criteria

- [ ] The §3.1 demo runs end-to-end on a clean stack with zero manual fixes mid-script.
- [ ] `grep -r "X-Reviewer-Id" apps packages` still returns zero.
- [ ] `SELECT count(*) FROM trace_correlation` ≥ 1 after the demo; reverse-lookup by `correlation_id` returns the demo task's trace.
- [ ] `/metrics` shows ≥1 observation of `harness_review_dwell_seconds`.
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` all green.
- [ ] `docs/retros/week-01.md` exists and names at least one real fragility.
- [ ] Architecture test asserts R7/R8 and no-engine-imports-another-engine.

**Checkpoint rule:** any red criterion — stop, fix today, do not carry a red Week 1 into Week 2.

---

## 6. Notes & Pitfalls

- **A demo that lies about identity is not a demo.** If the mock OIDC provider is flaky, note it — don't "simplify" into a fake cookie that skips the exchange.
- **The retro's most important question is the metric shape.** Week 3 fits weights against `was_useful`; a usefulness counter keyed wrong (or mishandling nulls) poisons the Day-11 dataset.
- **Watch for `correlation_id = "bootstrap"` spans.** A span outside the async-local context is a leak; this is the last cheap moment to find them before they pollute latency metrics.
- **Do not start Day 06's offline computation today.** A checkpoint is a stable line, not a head start.

---

*Prev: [Day 04 — Metrics: Routing, Review Dwell & Usefulness Counters](day-04.md) | Next: [Day 06 — Evaluation Metrics: Routing Precision/Recall Offline](day-06.md)*