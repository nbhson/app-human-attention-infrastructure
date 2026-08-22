# 10. Observability / Governance — Specification

**Status:** v0.1 (promoted from Phase-1 `docs/plan/phase-1/day-22..27`, reconciled against Week-1/2 as-built code — Day 10).
**Phase:** Identity + observability ship in Phase 2 Week 1 (Days 01–04); policy enforcement becomes load-bearing in Week 3 (Days 13–14).
**Depends on:** HAI Harness Architecture (1), Task Orchestrator (2), Attention Engine (6), Evaluation Engine (11).
**Governs:** every metric this pipeline emits, every event it logs, and who may change either.

> **Traceability note (Day 10 §2).** This spec is a *contract over what is shipped*, not a wishlist. Every requirement here is traceable to a built day; where Week 3 will add policy it is labelled `(planned, W3)` and never written as if it already exists.

---

## 1. Purpose

Measure and govern the pipeline: **every significant operation is observable and attributable.**

- **Observable** means a continuous, alertable metric or span exists for each decision that matters — routing, review, verification, context, identity — and every one of them can be joined back to the request that produced it.
- **Attributable** means no event lacks an actor or is invisible to audit: `event_log.actor_id`, `authz.decision_denied`, and append-only report history give operators an answer to "who did this, under what code, and when did the numbers change".

Governance is the *enforcement* half of observability: thresholds, guardrails, and change controls that stop the pipeline silently drifting into "whatever the code says". Without it, a metric that exists only as a SQL cookbook can't be plotted over time, and a threshold that lives only in a plan can be ignored by the next deploy.

**Spec boundary (Day 10 §6).** Metrics *definitions* live in Spec 11 §4; this spec *governs* them. If a requirement here starts redefining *precision*, it has crossed the line — delete it and point at Spec 11.

---

## 2. Identity

Identity is keyed on the **provider-stable OIDC `sub`**, never on email (emails are reassigned; the `sub` is what an identity provider guarantees is stable). Internal rows foreign-key to `User.id` (UUIDv7), so re-provisioning a user never rewrites history.

| Fact | Contract | Source |
|------|----------|--------|
| Uniqueness anchor | `users.oidc_sub` is unique; display data (`email`, `display_name`) may change | Day 01 (`packages/db/src/schema/users.ts`) |
| Roles | `users.roles` jsonb — `ADMIN ⊇ REVIEWER ⊇ OPERATOR`, additive; default `['OPERATOR']` on first sight | Day 02 (`packages/domain/src/identity.ts`) |
| Session/JWT | The JWT is the stateless identity; `sessions` row is the revocation source of truth — `revoked_at IS NULL` means active; logout kills every token minted under it | Day 01 (`sessions.ts`) |
| Auth principal | `AuthContext { user, sid, roles }` handed to request handlers | Day 02 (`identity.ts`) |

The session split is the load-bearing rule: **a signed token proves "who", a live `sessions` row proves "still allowed"**. A leaked token is dead the moment its session is revoked, signature valid or not.

---

## 3. Observability

Two substrates, one join key.

### 3.1 Distributed tracing + `trace_id ↔ correlation_id`

- **Async-local correlation context** (`@harness/observability/src/context.ts`) carries `{ correlationId, taskId }` through a request lifecycle; spans stamp `harness.correlation_id` at span *start*, without threading an id through every signature (Day 03 §2.1).
- **Reverse mapping** `trace_correlation` (one row per *root* span, written on root-span completion only) answers both directions: given a trace find the correlation id, given a correlation id find the trace (Day 03 §2.3). `trace_id`/`span_id` are stored as OTel hex strings, not UUIDs.
- **`correlation_id` = the task lifecycle id** in Phase 1–2, the same value `event_log.correlation_id` records, so traces and the event log reconcile by construction (Day 03, Day 27 §2.2).
- **No ambient context off a request:** every async worker re-establishes context via `runWithCorrelation` before starting spans; a stray span is stamped `bootstrap`, never silently correlated (Day 03 §2.1).

### 3.2 Prometheus metrics

- **Registry + `/metrics` scrape endpoint** (`packages/observability/src/metrics.ts`, `apps/api/src/routes/metrics.ts`) replaces the Phase-1 hand-rolled `/api/ops/metrics` JSON with the Prometheus text format.
- **Naming convention** `harness_<dimension>_<measure>_<unit>` makes every metric traceable to a Spec 11 definition (Day 04 §1).
- **Cardinality rule:** labels are bounded categorical values (`route`, `was_useful`). Never key a label on `correlation_id`/`task_id`/`user_id` — those live on span attributes and join via `trace_correlation` (Day 04 §2.3).

---

## 4. Metrics

The ten metric families, each keyed to its Spec 11 §4 parent (Day 04 §2.1):

| # | Metric | Type | Spec 11 | Computed |
|---|--------|------|---------|----------|
| 1 | `harness_routing_items_total{route}` | Counter | — | hot path (route ∈ human / auto_approvable) |
| 2 | `harness_routing_precision` | Gauge | §4.1 | offline, rolling window |
| 3 | `harness_routing_recall` | Gauge | §4.1 | offline, rolling window |
| 4 | `harness_routing_escalation_leakage` | Gauge | §4.1 | offline |
| 5 | `harness_attention_human_minutes_per_accept` | Gauge | §4.2 | offline |
| 6 | `harness_attention_inflation_ratio` | Gauge | §4.2 | offline |
| 7 | `harness_review_dwell_seconds` | Histogram | §4.2 | hot path (claim → decide) |
| 8 | `harness_assessment_usefulness_total{was_useful}` | Counter | §4.2 | hot path (`true/false/unknown`) |
| 9 | `harness_verification_false_pass_rate` | Gauge | §4.3 | offline |
| 10 | `harness_context_resupply_total` | Counter | §4.3 | hot path (`requestAdditionalContext`) |

**Gauges-vs-counters rule (Day 04 §2.1):** a value computed offline (precision/recall/leakage) is a **gauge** — set to the latest window result, never incremented; a value emitted on a discrete event is a **counter** — incremented once. Mixing them corrupts `rate()` semantics.

**Honesty rule (Day 06, `MetricsComputer`):**
- `undefined` is an honest hole, `NaN` is a lie — a zero denominator *omits* the metric rather than emitting `Infinity`/`NaN`.
- Missing dwell is not zero dwell — if an accepted decision lacks a claim→decide span, `human_minutes_per_accept` is omitted, not padded.

Definitions themselves are owned by Spec 11 §4.1–4.3 — see there, not here.

---

## 5. Audit

Three append-only surfaces, all attributable.

| Surface | Contract | Source |
|---------|----------|--------|
| `event_log` | Append-only (no UPDATE, no DELETE). Every bus event with `event_type`, `event_version`, `correlation_id`, and `actor_id` (set from the request-scoped actor; NULL for events outside any request). The source of truth for *what happened*; every other table is a current-state projection. | Day 02 §2.3, Day 04 §2.4 |
| `authz.decision_denied` | A denied attempt is **itself** evidence, not a silent 403. Emitted by `requireRole` with `{ actor_id, resource, roles_required }` for every authenticated-but-insufficiently-privileged refusal. | Day 02 §2.3 |
| `evaluation_reports` | Append-only report history; never UPDATE/DELETE a published report — a mistake is superseded by a new row. `source_version` attributes a trend to the code that produced it. | Day 07 §2.3 |

**Identity join:** `event_log.actor_id` and `decisions.actor_id` foreign-key to `users.id`, so an audit trail names the human, not just the token.

---

## 6. Governance policy

Policy is the part of this spec that becomes load-bearing *next* week. What exists today, and what is planned:

### 6.1 Shipped (Week 1–2)

- **Thresholds + adaptive nudge** — the Attention Engine's HIGH threshold is a real, logged, reversible knob: `+0.05` when >80% of the last week's HIGH items were judged "not useful", clamped to **`[0.60, 0.80]`**, with an `attention.threshold_adjusted` event recording before/after (Spec 6 §4.1, Day 29).
- **Priority-inflation monitor** — `harness_attention_inflation_ratio` tracks CRITICAL+HIGH share of assessments to catch score creep (Spec 6 §4.1, Day 04/06).
- **Report versioning** — `evaluation_reports.source_version` binds a trend to deploy code, so a precision drop crossing a deploy boundary reads as a version signal, not pipeline drift (Day 07).

### 6.2 Planned (Week 3)

- **Auto-approve flag + kill-switch** — a per-project policy flag that gates whether `AUTO_APPROVABLE` items skip human review, plus an operator kill-switch to force-review everything (Days 13–14). `(planned, W3)`.
- **Guardrail alerts** — governance alerts emitted off the audit surfaces when inflation/leakage cross ceilings (Spec 6 §4.1, Spec 11 §6). `(planned, W3)`.

**Rule:** any new policy control must ship with the audit event that records who changed it and to what. A threshold that flips silently is not governance, it is drift.

---

## 7. Non-Goals

- **Distributed tracing backends.** OTel spans and the `trace_correlation` map exist; a full Jaeger/Tempo collector, retention, and sampling posture are Phase-2 out-of-scope infrastructure.
- **Durable schedulers.** The report scheduler is an in-process cron; missed ticks are backfilled via `--from/--to`, not a durable queue.
- **Real-time training / closed-loop calibration.** Metrics are computed offline and feed Week 3 calibration; nothing re-trains on the hot path. The Evaluation Engine (11) owns that loop in Phase 3.
- **Log aggregation.** Event/evidence durability is the store's job; shipping/alerting on arbitrary logs is left to operators' existing tooling.

---

## 8. Cross-references

- **Spec 11 §4** — metric definitions this spec governs.
- **Spec 6 §4.1** — thresholds, guardrails, go/no-go policy.
- **Architecture §5** — subsystem table and spec-status note.
- **Days 01–04, 06–07, 29** — as-built sources in `docs/plan/phase-2/day-*.md`.
- **Next promotions:** Spec 8 (Human Review Interface) on Day 24.