# HAI Harness — Implementation Plans

The build is delivered in three phases. Each phase is an independent plan directory, gated by the exit criteria in Architecture §24.

| Phase | Directory | Theme | Estimate | Status |
|-------|-----------|-------|----------|--------|
| 1 | [phase-1/](phase-1/README.md) | Prove the Core Loop — vertical slice, evidence before confidence | 30 days (complete) | ✅ Foundation + Execution Core done; W3–W4 pending |
| 2 | [phase-2/](phase-2/README.md) | Calibrate & Close the Measurement Loop — evaluation, calibration, semantic infra (shadow) | 30 days | 🔲 Not started |
| 3 | [phase-3/](phase-3/README.md) | Learn & Automate Under Guardrails — memory, hybrid default, multi-agent, closed loop | 40 days | 🔲 Not started |

**Total: ~100 working days.**

Each phase README carries: goal, sizing rationale, tech-stack delta, weekly milestones, a daily breakdown table, and exit criteria. Every phase contains one detailed file per day (`phase-N/day-NN.md`) in the same format — Phase 1 has `day-01..30`, Phase 2 `day-01..30`, Phase 3 `day-01..40`.

Phase exit criteria (Architecture §24.3): **1 → 2** the loop is demountable end-to-end with queryable evidence; **2 → 3** the pipeline is measured (precision/recall, fitted weights, A/B harness); **3** the *Learning* step closes automatically.

---

## Phase 1 — Prove the Core Loop

**Goal:** By Day 30, deliver a working **vertical slice** of HAI Harness:

```
Task → Context → AI Agent execution → Artifact/Change tracking
     → Independent Verification → Attention Assessment
     → Human Review → Decision (APPROVE → merge / REJECT → rework)
     → Evidence recorded & queryable
```

Not a production system — a **correctly-architected, tested, end-to-end demonstrable** modular monolith that proves:
- **Evidence before confidence** — no change is "done" without verification evidence.
- **Human Attention as a first-class resource** — every review request is prioritized by the Attention Engine.
- **Claim ≠ Evidence** — the AI's report is never trusted without independent verification.
- **Full provenance** — every artifact answers: who, what, why, which model, which context, which evidence.

**Explicitly out of scope for 30 days:** multi-agent orchestration, embeddings/semantic search, Kafka, container-sandboxed verification, dependency-graph targeted verification, learning/calibration, Evaluation Engine (Spec 11).

### Tech Stack (locked for 30 days)

| Layer | Choice |
|-------|--------|
| Language | TypeScript (Node 20+) |
| Repo | pnpm workspaces + Turborepo |
| Database | PostgreSQL 16 + Drizzle ORM |
| Events | In-process `IEventBus` (EventEmitter impl) |
| LLM | `LLMProvider` adapter; Anthropic SDK + MockLLM |
| Tests | Vitest |
| API | Fastify |
| Web UI | React + Vite (minimal) |
| Infra | Docker Compose (postgres only) |

### Weekly Milestones

| Week | Theme | Milestone (demo-able at week's end) |
|------|-------|-------------------------------------|
| **W1 (D1–7)** | Foundation | Task CRUD persisted in Postgres; canonical state machine with transition validation; events flowing on IEventBus |
| **W2 (D8–14)** | Execution core | Orchestrator dispatches a task → Mock/Real LLM agent runs ReAct loop with tools → artifacts recorded with content hashes |
| **W3 (D15–21)** | Trust pipeline | Change verified independently (tsc + tests) → evidence stored → Attention Engine scores & routes → context snapshot served to agent |
| **W4 (D22–30)** | Human loop + E2E | Web UI review queue with diffs → approve/reject drives merge/rework → full vertical slice demo + hardening + docs |

### Daily Breakdown

| N | Day file | Focus | Package | Status |
|---|----------|-------|---------|--------|
| 1 | [day-01.md](phase-1/day-01.md) | Monorepo scaffold, tooling, CI skeleton | root | ✅ |
| 2 | [day-02.md](phase-1/day-02.md) | `packages/domain` — core types & branded IDs | @harness/domain | ✅ |
| 3 | [day-03.md](phase-1/day-03.md) | Event model + `IEventBus` | @harness/event-bus | ✅ |
| 4 | [day-04.md](phase-1/day-04.md) | PostgreSQL schema + migrations | @harness/db | ✅ |
| 5 | [day-05.md](phase-1/day-05.md) | Module boundaries + DI + dependency enforcement | @harness/di | ✅ |
| 6 | [day-06.md](phase-1/day-06.md) | Canonical Task state machine | @harness/orchestrator | ✅ |
| 7 | [day-07.md](phase-1/day-07.md) | **Week 1 checkpoint** — E2E smoke test | apps/api | ✅ |
| 8 | [day-08.md](phase-1/day-08.md) | Orchestrator core: queue + pull dispatch (`Dispatcher`, `DispatchLoop`) | @harness/orchestrator | ✅ |
| 9 | [day-09.md](phase-1/day-09.md) | Linear workflow execution (`WorkflowRunner`) | @harness/orchestrator | ✅ |
| 10 | [day-10.md](phase-1/day-10.md) | Retry, failure classification, idempotency | @harness/orchestrator | ✅ |
| 11 | [day-11.md](phase-1/day-11.md) | LLMProvider adapter + MockLLM | @harness/agent-runtime | ⚠️ |
| 12 | [day-12.md](phase-1/day-12.md) | ReAct loop, `AgentRunner`, `RuntimePollLoop` | @harness/agent-runtime | ✅ |
| 13 | [day-13.md](phase-1/day-13.md) | Tools (`read_file`, `write_file`, `run_command`) + TrajectoryRecorder | @harness/agent-runtime | ⚠️ |
| 14 | [day-14.md](phase-1/day-14.md) | **Week 2 checkpoint** — Artifact Tracker (snapshot dedup, ChangeStatusSubscriber) | @harness/artifact-tracker | ✅ |
| 15 | [day-15.md](phase-1/day-15.md) | Verification Engine: request handler + compile check (`CompileCheck`) | @harness/verification-engine | ✅ |
| 16 | [day-16.md](phase-1/day-16.md) | Test executor, timeouts, flaky handling (`TestCheck`) | @harness/verification-engine | ⚠️ |
| 17 | [day-17.md](phase-1/day-17.md) | Evidence storage + provenance linking + diff engine | @harness/verification-engine | ⚠️ |
| 18 | [day-18.md](phase-1/day-18.md) | Attention Engine scoring (Risk/Impact/Novelty/Complexity/Confidence) | @harness/attention-engine | ⚠️ |
| 19 | [day-19.md](phase-1/day-19.md) | AttentionPolicy rules + routing (REVIEW_REQUIRED vs AUTO_APPROVABLE) | @harness/attention-engine | ⚠️ |
| 20 | [day-20.md](phase-1/day-20.md) | Context Engine: collect → rank → budget | @harness/context-engine | ⚠️ |
| 21 | [day-21.md](phase-1/day-21.md) | **Week 3 checkpoint** — Context delivery, freshness check | @harness/context-engine | ⚠️ |
| 22 | [day-22.md](phase-1/day-22.md) | Review backend: queue API + decisions (`@harness/review`) | @harness/review | ⚠️ |
| 23 | [day-23.md](phase-1/day-23.md) | Review UI: queue + diff view (`apps/web`) | apps/web | ⚠️ |
| 24 | [day-24.md](phase-1/day-24.md) | Decision flow: merge on approve, rework on reject | apps/api | ⚠️ |
| 25 | [day-25.md](phase-1/day-25.md) | E2E vertical slice — happy path | apps/api | ⚠️ |
| 26 | [day-26.md](phase-1/day-26.md) | E2E — failure paths + provenance query UI | apps/api | ⚠️ |
| 27 | [day-27.md](phase-1/day-27.md) | Observability: logs, correlation IDs, audit queries | apps/api | ⚠️ |
| 28 | [day-28.md](phase-1/day-28.md) | Hardening: concurrency, failure injection, load smoke | apps/api | ⚠️ |
| 29 | [day-29.md](phase-1/day-29.md) | Documentation: specs → v0.2, dev guide, runbook | docs | ✅ |
| 30 | [day-30.md](phase-1/day-30.md) | **Final demo + retrospective + tag `v0.1.0-harness`** | root | ⚠️ |

### Phase 1 Exit Criteria (Day 30)

- [ ] `docker compose up && pnpm dev` starts the whole system with one fixture project.
- [ ] Scripted demo: create task → agent executes → change verified → scored → reviewed in UI → approved → merged, with provenance chain queryable end-to-end.
- [ ] Reject path demo: verification failure → task REWORK → retry limit → AWAITING_HUMAN_INTERVENTION.
- [ ] All packages ≥ 70% line coverage on core logic.
- [ ] Specs updated to v0.2 reflecting as-built reality; known gaps documented as Phase 2 backlog.
- [ ] Spec 9 (Memory/Evidence) preserved: evidence store is append-only and queryable end-to-end.
- [ ] Spec 11 (Evaluation Engine) left as a Phase-2 seam only.

---

## Phase 2 — Calibrate & Close the Measurement Loop

**Goal:** Phase 1 proved the core loop but is **unmeasured and uncalibrated**: the Attention weights are explicit placeholders, the Context ranker is keyword-only, auth is a single `X-Reviewer-Id` header, and the `AUTO_APPROVABLE` flag nobody acts on.

Phase 2's job is to **close the measurement loop**:

```
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

By the end of Phase 2, the pipeline is **measured**: metrics exist for routing precision/recall, Attention weights are fitted from real data, and the evaluation harness can compare two pipeline variants head-to-head.

**Explicitly out of scope for Phase 2:**
- Semantic retrieval is **installed but not default** (shadow mode behind the `Ranker` seam; hybrid default is Phase 3).
- Full Memory/Evidence subsystem (versioned write-back, consolidation/decay, decision memory) — Phase 3.
- Targeted/incremental verification (dependency graph) — Phase 3.
- Multi-agent orchestration / bounded autonomous loops — Phase 3.
- LLM-as-judge quality signals + benchmark corpus — Phase 3.

### Tech Stack Delta over Phase 1

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

### Repository / Architecture Delta

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

### Weekly Milestones

| Week | Theme | Milestone (demo-able at week's end) |
|------|-------|-------------------------------------|
| **W1 (D1–5)** | Identity & observability | SSO login, reviewer roles enforced; trace + metrics on a live run; `correlation_id` ↔ `trace_id` |
| **W2 (D6–10)** | Evaluation v0 + Spec 10 | Offline metrics report from real event/decision log; A/B shadow harness replays a recorded trajectory |
| **W3 (D11–15)** | Calibrate & gate auto-approve | Attention weights fitted from `was_useful`; adaptive thresholds; auto-approve behind flag + sampling audit |
| **W4 (D16–20)** | Semantic infra (shadow) | pgvector + Embedder populated; semantic rank computed *without* changing the default ranker; exact tokenizer + context cache |
| **W5 (D21–25)** | Sandbox, object store, Spec 8 | Container sandbox for verify + Code Mode; large artifacts in object store; Spec 8 promoted |
| **W6 (D26–30)** | Harden + exit review | Failure injection on new infra; E2E under Phase-2 stack; Phase 2→3 exit criteria met |

### Daily Breakdown

| N | Day file | Focus | Package |
|---|----------|-------|---------|
| 1 | [day-01.md](phase-2/day-01.md) | AuthN — OIDC SSO login, session/JWT, user identity model | @harness/auth |
| 2 | [day-02.md](phase-2/day-02.md) | AuthZ — reviewer roles, enforce on review/decision endpoints, identity on audit log | @harness/auth |
| 3 | [day-03.md](phase-2/day-03.md) | OpenTelemetry — spans across API/orchestrator/engines, trace_id ↔ correlation_id | @harness/observability |
| 4 | [day-04.md](phase-2/day-04.md) | Metrics — routing precision/recall, review dwell, usefulness counters; endpoints + dashboards | @harness/observability |
| 5 | [day-05.md](phase-2/day-05.md) | **Week 1 checkpoint** — identity + observability demonstrable | root |
| 6 | [day-06.md](phase-2/day-06.md) | Evaluation metrics — compute routing precision/recall + attention efficiency offline | @harness/evaluation |
| 7 | [day-07.md](phase-2/day-07.md) | Report generator — scheduled metrics report + trends | @harness/evaluation |
| 8 | [day-08.md](phase-2/day-08.md) | Trajectory replay engine — replay a recorded trajectory (Spec 3 §6.1) | @harness/evaluation |
| 9 | [day-09.md](phase-2/day-09.md) | A/B shadow harness — run two pipeline variants side-by-side, compare, zero production effect | @harness/evaluation |
| 10 | [day-10.md](phase-2/day-10.md) | **Promote Spec 10** (Observability/Governance) + metrics checkpoint | root |
| 11 | [day-11.md](phase-2/day-11.md) | Calibration dataset — extract `was_useful` + assessment + outcome into fit set | @harness/attention-engine |
| 12 | [day-12.md](phase-2/day-12.md) | Weight fitting — fit Attention weights; train/validation split; inflation-monitor before/after | @harness/attention-engine |
| 13 | [day-13.md](phase-2/day-13.md) | Adaptive thresholds + alert-fatigue monitor from real data (Spec 6 §4.1) | @harness/attention-engine |
| 14 | [day-14.md](phase-2/day-14.md) | Auto-approve behind flag — `AUTO_APPROVABLE` path + kill-switch + sampling audit, gated on calibration | @harness/attention-engine |
| 15 | [day-15.md](phase-2/day-15.md) | **Week 3 checkpoint** — before/after calibration + auto-approve flag demo | root |
| 16 | [day-16.md](phase-2/day-16.md) | pgvector migration + `Embedder` interface + provider adapter | @harness/embeddings |
| 17 | [day-17.md](phase-2/day-17.md) | Index population — embed sources/artifacts; re-embed on artifact change | @harness/embeddings |
| 18 | [day-18.md](phase-2/day-18.md) | Semantic retriever behind `Retriever`/`Ranker` seam — shadow (log, don't default) | @harness/context-engine |
| 19 | [day-19.md](phase-2/day-19.md) | Exact tokenizer (tiktoken/provider) replaces `chars/4`; budget trimmer update | @harness/context-engine |
| 20 | [day-20.md](phase-2/day-20.md) | Context cache (`source_id + content_hash`) + TTL/invalidate + freshness | @harness/context-engine |
| 21 | [day-21.md](phase-2/day-21.md) | Object store (S3/MinIO) — `ContentStore` seam for large artifacts (Spec 5 §4.2) | @harness/object-store |
| 22 | [day-22.md](phase-2/day-22.md) | Container sandbox for verification (Spec 7 §5.5) | @harness/sandbox |
| 23 | [day-23.md](phase-2/day-23.md) | Container sandbox for agent Code Mode (Spec 3 §14.3) | @harness/sandbox |
| 24 | [day-24.md](phase-2/day-24.md) | **Promote Spec 8** (Human Review Interface) to standalone spec | root |
| 25 | [day-25.md](phase-2/day-25.md) | **Week 5 checkpoint** — sandbox + object store + cache integrated; shadow metrics in report | root |
| 26 | [day-26.md](phase-2/day-26.md) | Hardening — failure injection on vector/object-store/sandbox, concurrency | root |
| 27 | [day-27.md](phase-2/day-27.md) | E2E under Phase-2 infra — full pipeline still passes with auth + sandbox + metrics | root |
| 28 | [day-28.md](phase-2/day-28.md) | Docs — specs to v0.3 where changed; dev guide + runbook update | docs |
| 29 | [day-29.md](phase-2/day-29.md) | A/B dry-run end-to-end — compare two context-ranking variants head-to-head | root |
| 30 | [day-30.md](phase-2/day-30.md) | **Phase 2→3 exit review** — metrics checkpoint, Phase 3 backlog, tag `v0.2.0-harness` | root |

### Phase 2 Exit Criteria (Phase 2 → 3)

- [ ] Routing precision/recall metrics computed and reviewed against a real decision log.
- [ ] Attention weights fitted from real `was_useful` data; inflation-monitor shows improvement over placeholders.
- [ ] A/B shadow harness replays a recorded trajectory and reports a head-to-head comparison with no production effect.
- [ ] Semantic infra (pgvector + Embedder) live in **shadow**: `rank_method` column retains `keyword` as default; semantic rank is logged and measurable via the harness.
- [ ] SSO/OIDC login + reviewer roles enforced; audit trail carries real identity.
- [ ] Auto-approve enabled only behind a flag + sampling audit, gated on the calibration threshold.
- [ ] Spec 8 (Human Review Interface) and Spec 10 (Observability/Governance) promoted to standalone specs.
- [ ] Container sandbox for verification and Code Mode demonstrable; large artifacts stored via `ContentStore`.
- [ ] `pnpm test && pnpm lint && pnpm e2e` green under the full Phase-2 stack.

### Phase 2 vs Phase 1: Từ Placeholder Sang Measured

| Lĩnh vực | Phase 1 (placeholder) | Phase 2 (real) |
|----------|----------------------|----------------|
| Attention weights | Hardcoded 0.35/0.25/... | Fitted từ data thật `was_useful` |
| Context ranking | Keyword + dependency proximity | Semantic (pgvector) trong **shadow mode** |
| Auth | Header `X-Reviewer-Id` | SSO/OIDC thật + reviewer roles |
| Observability | Event log đơn thuần | OpenTelemetry tracing + metrics dashboard |
| Evaluation | Không có | A/B shadow harness — so sánh 2 pipeline variants |
| Auto-approve | Flag tồn tại, không ai dùng | Gated sau calibration đạt ngưỡng + sampling audit |

---

## Phase 3 — Learn & Automate Under Guardrails

**Goal:** Phase 2 measured the pipeline. Phase 3 **closes the learning loop** — the *Learning* step of the critical milestone (Architecture §24.3) becomes a real subsystem:

```
                    ┌────────────────────────────────────────────┐
Phase 2 result     │  Pipeline đo được, weights calibrated,     │
                   │  nhưng vẫn cần con người review từng       │
                   │  item, context ranking chưa tối ưu,        │
                   │  verification chạy full-suite              │
                    └───────────────┬───────────────────────────┘
                                    ▼
    Evaluate → Calibrate → Deploy → Observe → (repeat) ← vòng này ĐÓNG LẠI
                                    │
                                    ▼
                         Learning step tự động hóa
```

Concretely, Phase 3 delivers the subsystems that Phase 1 deferred and Phase 2 only seamed:

1. **Full Memory / Evidence** — retrieval, decision memory, project memory, versioned write-back, consolidation/decay/archive.
2. **Targeted / incremental verification** — dependency-graph-driven test selection (the p95 latency driver).
3. **Hybrid context ranking as default** — BM25 + embeddings + RRF + re-rank + RAG Fusion.
4. **Multi-agent orchestration** — bounded autonomous loops, critique/revision (augmenting, never replacing, human decision).
5. **Benchmark corpus + LLM-as-judge** — gold labels + rubric-scored, audited quality signals.
6. **The closed loop** — evaluation and review decisions feed back into calibration and context ranking automatically.

**Explicitly out of scope (non-goals, restated):**
- Full microservices / K8s migration — the system stays a modular monolith.
- Autonomous decision-making that removes the human from the APPROVE/REJECT gate (multi-agent *bounded* loops only; `AUTO_APPROVABLE` remains the only auto-path, still sampled).
- GraphRAG / knowledge-graph over the codebase before the SQL dependency graph is proven.

### Tech Stack Delta over Phase 2

| Layer | Change | Anchor |
|-------|--------|--------|
| Code index | **tree-sitter** symbol index + dependency graph in Postgres | Spec 7 §5.2–5.3 |
| Retrieval | Hybrid (BM25 + embeddings) + RRF + re-rank → **default**; optional **RAG Fusion** | Context §5.1–5.2 |
| Memory | Write-back + consolidation / decay / archive (Postgres) | Memory §4.4–4.5 |
| Multi-agent | Bounded autonomous loops + critique/revision (entity: Orchestrator/Decomposer) | Spec 2 §10 |
| Benchmark | Container runtime (minimal bash + editor tools) + corpus gold labels | Spec 11 §5.1–5.2 |
| Judge | LLM-as-judge behind `LLMProvider` (rubric-scored, audited) | Spec 11 §5.1 |
| Queue *(optional)* | Durable queue (Redis/SQS) replacing in-process hand-off | Spec 2 §6 |

> **Invariant preserved:** durable queue is a *transport* swap behind `IEventBus` — the event contract does not change. Engines still never import each other.

### Repository / Architecture Delta

```text
packages/
├── memory/               # tiers, retrieval, write-back, consolidation/decay  (NEW)
├── code-index/           # tree-sitter symbol index + dependency graph         (NEW)
├── multi-agent/          # orchestration primitives + bounded autonomous loops  (NEW)
├── benchmark/            # corpus runtime (minimal container harness)          (NEW)
├── judge/                # LLM-as-judge rubric scoring behind LLMProvider       (NEW)
└── ... (existing packages; context-engine, verification-engine, orchestrator extended)
```

Existing packages gain: `context-engine` (hybrid default, RRF re-rank, RAG Fusion), `verification-engine` (dependency-graph targeted test selection), `orchestrator` (Decomposer: 3-level hierarchical planning, Plan-and-Solve/ReWOO, dynamic replanning; optional durable queue), `agent-runtime` (trajectory Fork/Resume, multi-agent roles).

### Weekly Milestones

| Week | Theme | Milestone (demo-able at week's end) |
|------|-------|-------------------------------------|
| **W1 (D1–5)** | Memory: store & retrieve | Decision/project memory written from evidence and read back with relevance scoring |
| **W2 (D6–10)** | Memory: lifecycle + trajectory | Consolidation/decay/archive validated; trajectory Fork and Resume demonstrable |
| **W3 (D11–15)** | Dependency graph → targeted verify | symbol index + graph; a change runs only affected tests, faster and still correct |
| **W4 (D16–20)** | Hybrid context default | BM25 + embeddings + RRF + re-rank is the default ranker; RAG Fusion behind `Retriever` |
| **W5 (D21–25)** | Multi-agent, bounded | MapReduce/Critique-Revision loops with hard budgets; AI-review-AI augments, never replaces human gate |
| **W6 (D26–30)** | Benchmark + judge | Corpus with gold labels + LLM-as-judge rubric scores run end-to-end |
| **W7 (D31–35)** | Close the loop | Evaluation → calibration → ranking update runs autonomously; durable-queue swap safe |
| **W8 (D36–40)** | Harden + exit | Multi-agent runaway guards, memory growth, hybrid latency; final docs + Phase-3 exit |

### Daily Breakdown

| N | Day file | Focus | Package |
|---|----------|-------|---------|
| 1 | [day-01.md](phase-3/day-01.md) | Memory model v2 — task/session/project/decision/failure/review tiers (Spec 9 §4.1) | @harness/memory |
| 2 | [day-02.md](phase-3/day-02.md) | Memory ingestion — evidence → distillation → versioned append-only writes | @harness/memory |
| 3 | [day-03.md](phase-3/day-03.md) | Memory retrieval — relevance scoring (`0.6·sim + 0.2·recency + 0.2·access`), served to Context | @harness/memory |
| 4 | [day-04.md](phase-3/day-04.md) | Versioned write-back — `supersedes`, Git-like log/rollback, forget/update cross-check (§4.4) | @harness/memory |
| 5 | [day-05.md](phase-3/day-05.md) | **Week 1 checkpoint** — memory write+read demonstrable | root |
| 6 | [day-06.md](phase-3/day-06.md) | Consolidation — dedup (0.85), conflict strategy, decay (`0.99^days`) (§4.5) | @harness/memory |
| 7 | [day-07.md](phase-3/day-07.md) | Archive (90d) + expiration; hot/cold tier | @harness/memory |
| 8 | [day-08.md](phase-3/day-08.md) | Trajectory Fork — head-to-head model/prompt/context comparison (Spec 3 §6.1) | @harness/agent-runtime |
| 9 | [day-09.md](phase-3/day-09.md) | Trajectory Resume — crash recovery + mid-run replay (Spec 3 §6.1) | @harness/agent-runtime |
| 10 | [day-10.md](phase-3/day-10.md) | **Week 2 checkpoint** — consolidation/decay validated against decision log | root |
| 11 | [day-11.md](phase-3/day-11.md) | tree-sitter symbol index — functions/classes/imports for target repo | @harness/code-index |
| 12 | [day-12.md](phase-3/day-12.md) | Dependency graph build (file/module edges) in Postgres | @harness/code-index |
| 13 | [day-13.md](phase-3/day-13.md) | Impact analysis — map a change to affected tests (transitive) | @harness/code-index |
| 14 | [day-14.md](phase-3/day-14.md) | Targeted/incremental verification — run only affected tests via graph (Spec 7 §5.2–5.3) | @harness/verification-engine |
| 15 | [day-15.md](phase-3/day-15.md) | **Week 3 checkpoint** — targeted verification faster + still correct | root |
| 16 | [day-16.md](phase-3/day-16.md) | Hybrid retriever as default — BM25 lexical + embedding semantic fused | @harness/context-engine |
| 17 | [day-17.md](phase-3/day-17.md) | RRF fusion (k=60) + re-rank (dependency/recency/usage heuristics) | @harness/context-engine |
| 18 | [day-18.md](phase-3/day-18.md) | RAG Fusion (multi-query + reciprocal ranking) behind `Retriever` | @harness/context-engine |
| 19 | [day-19.md](phase-3/day-19.md) | Integrate hybrid default; `rank_method` cutover; A/B vs shadow baseline | @harness/context-engine |
| 20 | [day-20.md](phase-3/day-20.md) | **Week 4 checkpoint** — lost-in-middle + freshness under hybrid; shadow→default cutover clean | root |
| 21 | [day-21.md](phase-3/day-21.md) | Multi-agent primitives — MapReduce / Critique-Revision / Ensemble | @harness/multi-agent |
| 22 | [day-22.md](phase-3/day-22.md) | Bounded autonomous loops — max iterations, token budget, guardrails | @harness/multi-agent |
| 23 | [day-23.md](phase-3/day-23.md) | Role taxonomy (Coder/Reviewer/Tester/Orchestrator) — AI review augments, never replaces human | @harness/multi-agent |
| 24 | [day-24.md](phase-3/day-24.md) | Decomposer — 3-level hierarchical planning, Plan-and-Solve/ReWOO, dynamic replanning (Spec 2 §10) | @harness/orchestrator |
| 25 | [day-25.md](phase-3/day-25.md) | **Week 5 checkpoint** — multi-agent demo + guardrail proofs | root |
| 26 | [day-26.md](phase-3/day-26.md) | Benchmark corpus — versioned gold labels (SWE-bench-style tasks) | @harness/benchmark |
| 27 | [day-27.md](phase-3/day-27.md) | Benchmark runtime — Minimal Benchmark Harness container (bash + editor) (Spec 11 §5.1–5.2) | @harness/benchmark |
| 28 | [day-28.md](phase-3/day-28.md) | LLM-as-judge — rubric-scored behind `LLMProvider`, audited (Spec 11 §5.1) | @harness/judge |
| 29 | [day-29.md](phase-3/day-29.md) | Judge calibration + inter-judge agreement + audit trail | @harness/judge |
| 30 | [day-30.md](phase-3/day-30.md) | **Week 6 checkpoint** — benchmark + judge run end-to-end on corpus | root |
| 31 | [day-31.md](phase-3/day-31.md) | Learning pipeline — evaluation results → calibration update (automated) | root |
| 32 | [day-32.md](phase-3/day-32.md) | Feedback into context ranking — learn ranking params from usefulness | @harness/context-engine |
| 33 | [day-33.md](phase-3/day-33.md) | Closed loop wiring — Evaluate → Calibrate → Deploy → Observe runs continuously | root |
| 34 | [day-34.md](phase-3/day-34.md) | Durable queue (Redis/SQS) behind `IEventBus` (contract unchanged; optional) (Spec 2 §6) | @harness/orchestrator |
| 35 | [day-35.md](phase-3/day-35.md) | **Week 7 checkpoint** — closed loop demonstrable autonomously | root |
| 36 | [day-36.md](phase-3/day-36.md) | Hardening — multi-agent runaway guards, memory growth, hybrid latency | root |
| 37 | [day-37.md](phase-3/day-37.md) | E2E full system under Phase-3 infra + load profile | root |
| 38 | [day-38.md](phase-3/day-38.md) | Docs — specs to v1.0 candidates, runbook + dev guide | docs |
| 39 | [day-39.md](phase-3/day-39.md) | Benchmark regression + judge-agreement report | root |
| 40 | [day-40.md](phase-3/day-40.md) | **Phase-3 exit review** — Learning closed + demonstrable; tag release | root |

### Phase 3 Exit Criteria

- [ ] The *Learning* step closes automatically: evaluation results and review decisions feed back into calibration and context ranking.
- [ ] Targeted/incremental verification demonstrably reduces verify latency versus full-suite baseline, with no correctness regression on the golden suite.
- [ ] Hybrid context ranking (BM25 + embeddings + RRF + re-rank) is the default; RAG Fusion optional behind `Retriever`.
- [ ] Memory subsystem: write-back, consolidation, decay, archive, relevance-scored retrieval all live; decision memory surfaces past outcomes to Attention.
- [ ] Trajectory Fork/Resume demonstrable (head-to-head compare + crash recovery).
- [ ] Multi-agent loops run within hard budgets; every human-facing decision still routes through the human gate (or sampling-audited `AUTO_APPROVABLE`).
- [ ] Benchmark corpus (versioned gold labels) + LLM-as-judge (rubric-scored, audited) producing quality signals used by ranking/calibration.
- [ ] `pnpm test && pnpm lint && pnpm e2e` green under the full Phase-3 stack; closed-loop job runs end-to-end autonomously.

### Phase 3 vs Phase 1: Từ Placeholder Sang Auto-Pilot

| Lĩnh vực | Phase 1 (placeholder) | Phase 3 (default/auto) |
|----------|----------------------|------------------------|
| Context ranking | Keyword + dependency proximity | Hybrid BM25 + embeddings + RRF + re-rank → **default** |
| Verification | Full-suite (tất cả tests) | Targeted/incremental (chỉ chạy tests liên quan qua dependency graph) |
| Memory | Không có | Versioned write-back, consolidation, decay, archive |
| Trajectory | Không có | Fork (head-to-head compare) + Resume (crash recovery) |
| Multi-agent | Không có | Bounded autonomous loops — AI critique/revision, human gate giữ nguyên |
| Benchmark | Không có | Corpus gold labels + LLM-as-judge (rubric-scored) |
| Learning loop | Thủ công (người đọc report → tune) | Tự động: evaluation results → calibration update → ranking update |

---

## How to Use This Plan

1. **One file per day**, authored at kickoff in the same format as `phase-1/day-NN.md`.
2. **Checkpoints are non-negotiable** — stop feature work, make the week's slice demonstrable, fix integration debt immediately.
3. **Every Phase-2 addition hangs off a Phase-1 seam.** If a change requires editing an engine's *internal* contract (not its interface), stop and reassess.
4. **Shadow-then-default is the standing rule** for semantic retrieval in Phase 2; resolved in Phase 3 by A/B win.
5. **Calibration gates auto-approve** in Phase 2 — confidence without evidence is the exact failure this system exists to prevent.
6. **Every automaton is bounded** in Phase 3 — multi-agent loops have iteration + token ceilings; runaway is a *failure mode to test*, not a feature to accept.
7. **AI never becomes authority** — critique/revision augments Verification and Attention; the human APPROVE/REJECT gate is untouched except for the already-gated auto-approve path.
