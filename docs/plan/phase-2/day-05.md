# Day 05 — Week 1 Checkpoint: Identity & Observability

| | |
|---|---|
| **Week** | 1 — Identity & observability |
| **Spec refs** | Architecture §4.4 + §24.3 (exit criterion: SSO + audit identity), Spec 11 §4 (metrics present), Spec 2 §8 |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Days 01–04 (auth, authz, OTel, metrics) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A **scripted, live demo** of the Week-1 milestone: SSO login → reviewer role enforced → a real run that emits spans with `trace_id ↔ correlation_id` → metrics on `/metrics`.
2. A **Week-1 retrospective** capturing what solid, what fragile, and the decisions that Week 2 (evaluation) will lean on.
3. A **green CI gate** over the whole Phase-2 stack so far: lint, typecheck, unit + integration, migration, boundaries.

**Do not proceed to Day 06 (evaluation metrics) until every criterion in §5 is green.** The entire point of Week 2 is to *measure* — measuring with broken identity or half-wired telemetry produces garbage numbers that Week 3 would then "calibrate" against. Garbage in, garbage treeline out.

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

```bash
docker compose down -v && docker compose up -d
pnpm db:migrate && pnpm dev
```

1. **Login:** hit `/api/auth/login`, complete the (mock) OIDC redirect, get a session cookie; show `/api/auth/session` returning a real `{ sub, roles }`.
2. **AuthZ:** as an `OPERATOR`, `POST /api/review/queue/:id/decide` → 403 + `authz.decision_denied` in `event_log`; as `REVIEWER` → 200.
3. **Trace:** run one happy-path task; show the root span's `harness.correlation_id` attribute and the `trace_correlation` row; `SELECT trace_id FROM trace_correlation WHERE correlation_id = '…'`.
4. **Metrics:** `curl /metrics` shows `harness_routing_items_total`, `harness_review_dwell_seconds`, `harness_assessment_usefulness_total`.

### 3.2 Week-1 retrospective (60 min)

`docs/retros/week-01.md` — blameless, numbers-first. Questions to answer:
- Is the async-local correlation model holding up in the event-handler path, or are there spans escaping with `correlation_id = bootstrap`?
- Did removing `X-Reviewer-Id` break any Phase-1 test that hard-coded `reviewer-1`? If so, were they fixed or merely masked?
- Is the metric inventory the right shape for Week 3's before/after calibration? What's missing?
- Any boundary temptation so far — did an engine reach for another engine to avoid emitting an event?

### 3.3 Harden CI + fix all red (up to 2h)

- [ ] `.github/workflows/ci.yml` — add the auth + observability packages to the test matrix; add a Postgres + (mock) OIDC service container.
- [ ] `pnpm lint` zero; `pnpm -r typecheck` zero; `pnpm -r test` green (unit + integration).
- [ ] Boundary/architecture test green with R7–R8 in force.

### 3.4 Update wiring map + README (30 min)

- [ ] `docs/architecture/wiring-map.md` — confirm all Week-1 registrations (AuthService, SessionService, Tracer, Meter, MetricsRegistry) listed with concrete classes.
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
- [ ] `grep -r "X-Reviewer-Id" apps packages` still returns zero (no regression in the week's churn).
- [ ] `SELECT count(*) FROM trace_correlation` is ≥ 1 after the demo run, and reverse-lookup by `correlation_id` returns the demo task's trace.
- [ ] `/metrics` shows at least one observation of `harness_review_dwell_seconds` from the demo decision.
- [ ] `pnpm lint && pnpm -r typecheck && pnpm -r test` all green.
- [ ] `docs/retros/week-01.md` exists and names at least one real fragility.
- [ ] Architecture test asserts R7/R8 and that no engine imports another engine.

**Checkpoint rule:** any red criterion — stop, fix today, do not carry a red Week 1 into Week 2.

---

## 6. Notes & Pitfalls

- **A demo that needs a human to hand-hold the redirect is fine; a demo that lies about identity is not.** If the mock OIDC provider is flaky, note it — do not "simplify" the demo into a fake cookie that skips the exchange. Week 2 measures real identity.
- **The retro's most important question is the metric shape.** Week 3 fits weights against `was_useful`; if the usefulness counter today keys on the wrong event (or `null` handling is off), the calibration dataset (Day 11) inherits the bug. Flag it now, while it's cheap.
- **Watch for `correlation_id = "bootstrap"` spans.** Any span that doesn't participate in the async-local context is a leak. This checkpoint's demo is the last cheap moment to find them before they pollute Week-2 latency metrics.
- **Do not start Day 06's offline metric computation today.** The whole week has been plumbing; tomorrow starts the *measurement* subsystem. Resist the 30-minute temptation to "just compute precision while it's fresh" — a checkpoint is a stable line, not a head start.

---

*Prev: [Day 04 — Metrics: Routing, Review Dwell & Usefulness Counters](day-04.md) | Next: [Day 06 — Evaluation Metrics: Routing Precision/Recall Offline](day-06.md)*