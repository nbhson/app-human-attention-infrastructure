# HAI Harness — Phase 2 Implementation Plan

**Version:** v0.2
**Created:** 2026-08-20
**Status:** ✅ **Complete** — tagged `v0.2.0-harness` (8/9 §7 exit criteria met; see the [metrics checkpoint](../retros/phase2-metrics.md)).
**Prerequisite:** Phase 1 complete (`docs/plan/phase-1/`), loop demonstrable end-to-end, evidence queryable, `v0.1.0-harness` tagged.
**Specs:** `docs/core/1..7, 9, 11` (as-built v0.2) + promote Spec 8 (Human Review Interface) and Spec 10 (Observability/Governance) to standalone specs.

---

## 1. Goal of the Phase

Phase 1 proved the core loop but is **unmeasured and uncalibrated**: the Attention weights are explicit placeholders, the Context ranker is keyword-only, auth is a single `X-Reviewer-Id` header, and the `AUTO_APPROVABLE` flag nobody acts on.

Phase 2's job is to **close the measurement loop**:

```text
             ┌────────────────────────────────────────────┐
             │  Phase 1 result: pipeline runs, evidence    │
             │  collected, but nobody can say how well.    │
             └───────────────────────┬────────────────────┘
                                     ▼
   Evaluate (offline metrics + A/B shadow harness)
        → Calibrate (fit Attention weights from real `was_useful`)
        → (auto-approve gated behind the calibration threshold)
        → Semantic infra installed as a *shadow* upgrade path
        → Identity + observability + governance promoted to contracts
```

By the end of Phase 2, the pipeline is **measured**: metrics exist for routing precision/recall, Attention weights are fitted from real data, and the evaluation harness can compare two pipeline variants head-to-head (Architecture §24.3 exit criterion).

### Explicitly out of scope for Phase 2

- Semantic retrieval is **installed but not default** (shadow mode behind the `Ranker` seam; hybrid default is Phase 3).
- Full Memory/Evidence subsystem (versioned write-back, consolidation/decay, decision memory) — Phase 3.
- Targeted/incremental verification (dependency graph) — Phase 3.
- Multi-agent orchestration / bounded autonomous loops — Phase 3.
- LLM-as-judge quality signals + benchmark corpus — Phase 3.

---

## 2. Sizing Rationale

**Estimate: 30 working days (6 weeks).** Same cadence as Phase 1 (weekly checkpoints, one deliverable slice per week) — chosen because each week here rests on the previous one's measurements, not because the work is half of Phase 3. Phase 2 is *integration-and-measurement* heavy; Phase 3 (40 days) is *new-subsystem* heavy. The two measurements properties set the split: Phase 2 can be done without building new semantic-hybrid or memory subsystems; it only needs the seams those subsystems will later plug into.

---

## 3. Tech Stack — Delta over Phase 1

| Layer | Change | Anchor |
|-------|--------|--------|
| Identity | **SSO/OIDC** (session/JWT) replaces `X-Reviewer-Id` header; reviewer roles | day-30 P0 |
| Observability | **OpenTelemetry** tracing (span ↔ `correlation_id`); Prometheus metrics | promote Spec 10 |
| Data | PostgreSQL 16 + **`pgvector`** (embeddings) + `pg_trgm`/FTS (BM25 lexical) | Context §5.1 |
| Tokenizer | **Exact tokenizer** (tiktoken/provider-specific) replaces `chars/4` | Context §8 |
| Embeddings | `Embedder` interface (provider adapter), loaded behind `Retriever`/`Ranker` seam | Context §5.1 |
| Context cache | Cache keyed by `source_id + content_hash`, TTL + invalidate | Context §5.2.3 |
| Object store | **S3/MinIO** for large artifacts (content-addressed) | Spec 5 §4.2 |
| Evaluation | Offline metrics + **shadow A/B harness** (trajectory replay) | Spec 11 §5 |
| Sandbox | **Container** (or git worktree) per verification & agent run | Spec 7 §5.5 · Spec 3 §14.3 |

> **Invariant preserved:** still a modular monolith, still Postgres-centric, still `IEventBus`. Phase 2 only widens infrastructure *behind* the seams declared in Phase 1 (`Ranker`, `Retriever`, `Embedder`, `ContentStore`, `LLMProvider`). No engine imports another engine.

---

## 4. Repository / Architecture Delta

```text
packages/
├── auth/                 # OIDC login, sessions, reviewer role enforcement  (NEW)
├── observability/        # OTel spans, metrics registry, audit queries      (NEW)
├── evaluation/           # metrics computation, reports, A/B shadow harness  (NEW)
├── embeddings/           # Embedder interface + provider adapter              (NEW)
├── object-store/         # S3/MinIO-backed ContentStore                       (NEW)
├── sandbox/              # container runtime for verification & Code Mode     (NEW)
└── ... (existing packages unchanged; context-engine gains semantic shadow path)
```

Existing packages gain: `context-engine` (semantic retriever in shadow, exact tokenizer, cache), `attention-engine` (calibrated weights + adaptive thresholds), `review` (behind `auth/`), `db` (pgvector + object-store + auth schema migrations).

---

## 5. Weekly Milestones

| Week | Theme | Milestone (demo-able at week's end) |
|------|-------|-------------------------------------|
| **W1 (D1–5)** | Identity & observability | SSO login, reviewer roles enforced; trace + metrics on a live run; `correlation_id` ↔ `trace_id` |
| **W2 (D6–10)** | Evaluation v0 + Spec 10 | Offline metrics report from real event/decision log; A/B shadow harness replays a recorded trajectory |
| **W3 (D11–15)** | Calibrate & gate auto-approve | Attention weights fitted from `was_useful`; adaptive thresholds; auto-approve behind flag + sampling audit |
| **W4 (D16–20)** | Semantic infra (shadow) | pgvector + Embedder populated; semantic rank computed *without* changing the default ranker; exact tokenizer + context cache |
| **W5 (D21–25)** | Sandbox, object store, Spec 8 | Container sandbox for verify + Code Mode; large artifacts in object store; Spec 8 promoted |
| **W6 (D26–30)** | Harden + exit review | Failure injection on new infra; E2E under Phase-2 stack; Phase 2→3 exit criteria met |

---

## 6. Daily Files

Each day has its own file with objectives, tasks, deliverables, and acceptance criteria (authored at phase kickoff, same per-file granularity as Phase 1):

| N | Day file | Focus |
|---|----------|-------|
| 1 | [day-01.md](day-01.md) | AuthN — OIDC SSO login, session/JWT, user identity model |
| 2 | [day-02.md](day-02.md) | AuthZ — reviewer roles, enforce on review/decision endpoints, identity on audit log |
| 3 | [day-03.md](day-03.md) | OpenTelemetry — spans across API/orchestrator/engines, trace_id ↔ correlation_id |
| 4 | [day-04.md](day-04.md) | Metrics — routing precision/recall, review dwell, usefulness counters; endpoints + dashboards |
| 5 | [day-05.md](day-05.md) | **Week 1 checkpoint** — identity + observability demonstrable |
| 6 | [day-06.md](day-06.md) | Evaluation metrics — compute routing precision/recall + attention efficiency offline |
| 7 | [day-07.md](day-07.md) | Report generator — scheduled metrics report + trends |
| 8 | [day-08.md](day-08.md) | Trajectory replay engine — replay a recorded trajectory (Spec 3 §6.1) |
| 9 | [day-09.md](day-09.md) | A/B shadow harness — run two pipeline variants side-by-side, compare, zero production effect |
| 10 | [day-10.md](day-10.md) | **Promote Spec 10** (Observability/Governance) + metrics checkpoint |
| 11 | [day-11.md](day-11.md) | Calibration dataset — extract `was_useful` + assessment + outcome into fit set |
| 12 | [day-12.md](day-12.md) | Weight fitting — fit Attention weights; train/validation split; inflation-monitor before/after |
| 13 | [day-13.md](day-13.md) | Adaptive thresholds + alert-fatigue monitor from real data (Spec 6 §4.1) |
| 14 | [day-14.md](day-14.md) | Auto-approve behind flag — `AUTO_APPROVABLE` path + kill-switch + sampling audit, gated on calibration |
| 15 | [day-15.md](day-15.md) | **Week 3 checkpoint** — before/after calibration + auto-approve flag demo |
| 16 | [day-16.md](day-16.md) | pgvector migration + `Embedder` interface + provider adapter |
| 17 | [day-17.md](day-17.md) | Index population — embed sources/artifacts; re-embed on artifact change |
| 18 | [day-18.md](day-18.md) | Semantic retriever behind `Retriever`/`Ranker` seam — shadow (log, don't default) |
| 19 | [day-19.md](day-19.md) | Exact tokenizer (tiktoken/provider) replaces `chars/4`; budget trimmer update |
| 20 | [day-20.md](day-20.md) | Context cache (`source_id + content_hash`) + TTL/invalidate + freshness |
| 21 | [day-21.md](day-21.md) | Object store (S3/MinIO) — `ContentStore` seam for large artifacts (Spec 5 §4.2) |
| 22 | [day-22.md](day-22.md) | Container sandbox for verification (Spec 7 §5.5) |
| 23 | [day-23.md](day-23.md) | Container sandbox for agent Code Mode (Spec 3 §14.3) |
| 24 | [day-24.md](day-24.md) | **Promote Spec 8** (Human Review Interface) to standalone spec |
| 25 | [day-25.md](day-25.md) | **Week 5 checkpoint** — sandbox + object store + cache integrated; shadow metrics in report |
| 26 | [day-26.md](day-26.md) | Hardening — failure injection on vector/object-store/sandbox, concurrency |
| 27 | [day-27.md](day-27.md) | E2E under Phase-2 infra — full pipeline still passes with auth + sandbox + metrics |
| 28 | [day-28.md](day-28.md) | Docs — specs to v0.3 where changed; dev guide + runbook update |
| 29 | [day-29.md](day-29.md) | A/B dry-run end-to-end — compare two context-ranking variants head-to-head |
| 30 | [day-30.md](day-30.md) | **Phase 2→3 exit review** — metrics checkpoint, Phase 3 backlog, tag `v0.2.0-harness` |

---

## 7. Exit Criteria (Phase 2 → 3, from Architecture §24.3)

- [x] Routing precision/recall metrics computed and reviewed against a real decision log — precision 0.333 / recall 0.5 / escalation-leakage 1.0 (N=4).
- [ ] Attention weights fitted from real `was_useful` data; inflation-monitor shows improvement over placeholders — **fitted, not improved** (held back to the placeholder).
- [x] A/B shadow harness replays a recorded trajectory and reports a head-to-head comparison with no production effect — day-29 `rank_correlation = [-1.0, -1.0]`, guardrail HELD.
- [x] Semantic infra (pgvector + Embedder) live in **shadow**: `rank_method` column retains `keyword` as default; semantic rank is logged and measurable via the harness.
- [x] SSO/OIDC login + reviewer roles enforced; audit trail carries real identity.
- [x] Auto-approve enabled only behind a flag + sampling audit, gated on the calibration threshold — flag OFF at rest, kill-switch armed.
- [x] Spec 8 (Human Review Interface) and Spec 10 (Observability/Governance) promoted to standalone specs.
- [x] Container sandbox for verification and Code Mode demonstrable; large artifacts stored via `ContentStore`.
- [x] `pnpm test && pnpm lint && pnpm e2e` green under the full Phase-2 stack.

---

## 8. How to Use This Plan

1. **One file per day**, authored at kickoff in the same format as `phase-1/day-NN.md` (Objectives / Design Decisions / Tasks / Deliverables / Acceptance Criteria / Notes).
2. **Checkpoints (D5, D10, D15, D20, D25) are non-negotiable** — stop feature work, make the slice demonstrable.
3. **Every Phase-2 addition hangs off a Phase-1 seam.** If a change requires editing an engine's *internal* contract (not its interface), stop and reassess — that is a Phase-1 boundary violation.
4. **Shadow-then-default** is the standing rule for semantic retrieval: nothing uses embeddings as its default signal in this phase.
5. **Calibration gates auto-approve.** Do not flip the auto-approve flag until the weight-fit and inflation monitor are green — confidence without evidence is the exact failure this system exists to prevent.

---

*Prev phase: [Phase 1 — Prove the Core Loop](../phase-1/README.md) | Next phase: [Phase 3 — Learn & Automate Under Guardrails](../phase-3/README.md)*