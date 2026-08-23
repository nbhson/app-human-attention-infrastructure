# HAI Harness — Implementation Plans

The build is delivered in three phases, each an independent plan directory gated by the exit criteria in Architecture §24.

> **`review-reorient` (v0.6) — re-authored.** This plan set was **rewritten** to describe the
> product as it now is: a **review-only control plane** — a human pastes an external PR/MR
> URL + a Jira ticket, the harness fetches the diff + requirement (`@harness/git-provider`,
> `@harness/ticket-provider`), the configured AI acts as **reviewer** (report + findings +
> fix suggestions), verification clones + runs tests in the Docker sandbox, and a human
> decides. The AI never writes or commits code. The now-retired code-generation path
> (dispatcher, workflow runner, `AgentRunner`/ReAct, `MergeService`/`ReworkService`, the
> startup reconciler, agent Code-Mode) no longer appears in these plans; the honest
> build history — including what changed — is preserved in `docs/retros/`.

| Phase | Directory | Theme | Estimate | Status |
|-------|-----------|-------|----------|--------|
| 1 | [phase-1/](phase-1/README.md) | Prove the Review Core Loop — PR → AI review → verify → attention → human decision → evidence | 30 days | ✅ Complete — tagged v0.1.0-harness |
| 2 | [phase-2/](phase-2/README.md) | Calibrate & Secure the Review Pipeline — evaluation, calibration, semantic infra (shadow), auth, sandbox | 30 days | ✅ Complete — tagged v0.2.0-harness |
| 3 | [phase-3/](phase-3/README.md) | Breadth, Write-back & Close the Loop — GitLab/Bitbucket/Jira, write-back, verify breadth, review memory, review-quality calibration | 40 days | 🔲 Not started |

**Total: ~100 working days.**

Each phase README carries: goal, sizing rationale, tech-stack delta, weekly milestones, a daily breakdown table, and exit criteria. Every phase contains one detailed file per day (`phase-N/day-NN.md`) in the same format — Phase 1 has `day-01..30`, Phase 2 `day-01..30`, Phase 3 `day-01..40`.

Phase exit criteria (Architecture §24.3): **1 → 2** the review loop is demonstrable end-to-end with queryable evidence; **2 → 3** the review pipeline is measured (precision/recall, fitted weights, A/B harness); **3** the *Learning* step closes automatically.

---

## Phase 1 — Prove the Review Core Loop

**Goal:** By Day 30, deliver a working **vertical slice** of the review control plane:

```
PR/MR + Jira ticket  →  fetch diff + requirement  →  AI review (report + findings + fix suggestions)
                     →  independent verification  →  attention assessment
                     →  human review → decision  →  evidence recorded & queryable
```

Not a production system — a **correctly-architected, tested, end-to-end demonstrable** modular monolith that proves:
- **Evidence before confidence** — no review is "done" without verification evidence.
- **Human Attention as a first-class resource** — every review is prioritized by the Attention Engine.
- **Claim ≠ Evidence** — the AI's report is never trusted without independent verification.
- **Full provenance** — every review answers: who, what, why, which model, which context, which evidence.

**Explicitly out of scope for 30 days:** GitLab/Bitbucket providers (GitHub only), write-back to PR/Jira, multi-provider breadth, embeddings/semantic search, container-sandboxed verification, dependency-graph targeted verification, learning/calibration, Evaluation Engine (Spec 11).

### Tech Stack (locked for 30 days)

| Layer | Choice |
|-------|--------|
| Language | TypeScript (Node 20+) |
| Repo | pnpm workspaces + Turborepo |
| Database | PostgreSQL 16 + Drizzle ORM |
| Events | In-process `IEventBus` (EventEmitter impl) |
| LLM | `LLMProvider` adapter; Anthropic + OpenAI-compatible (`key`+`baseUrl`+`model`) + MockLLM |
| Tests | Vitest |
| API | Fastify |
| Web UI | React + Vite (minimal) |
| Infra | Docker Compose (postgres only) |

### Weekly Milestones

| Week | Theme | Milestone (demo-able at week's end) |
|------|-------|-------------------------------------|
| **W1 (D1–7)** | Foundation | Domain/events/db/DI wired; canonical state machine; events flowing on IEventBus |
| **W2 (D8–14)** | Review ingest core | GitHubProvider fetches a PR diff; ReviewAgent produces a report; review slice persists findings + suggestions |
| **W3 (D15–21)** | Trust pipeline | Change verified independently (tsc + tests) → evidence stored → Attention scores & routes → context served to Reviewer |
| **W4 (D22–30)** | Human loop + E2E | Review UI queue with diff + report → human decision → full vertical slice demo + hardening + docs |

### Daily Breakdown

| N | Day file | Focus | Package | Status |
|---|----------|-------|---------|--------|
| 1 | [day-01.md](phase-1/day-01.md) | Monorepo scaffold, tooling, CI skeleton | root | ✅ |
| 2 | [day-02.md](phase-1/day-02.md) | `packages/domain` — core types, branded IDs, review-report types | @harness/domain | ✅ |
| 3 | [day-03.md](phase-1/day-03.md) | Event model + `IEventBus` | @harness/event-bus | ✅ |
| 4 | [day-04.md](phase-1/day-04.md) | PostgreSQL schema + migrations (incl. review tables) | @harness/db | ✅ |
| 5 | [day-05.md](phase-1/day-05.md) | Module boundaries + DI + dependency enforcement | @harness/di | ✅ |
| 6 | [day-06.md](phase-1/day-06.md) | Canonical Task state machine (13 states) | @harness/orchestrator | ✅ |
| 7 | [day-07.md](phase-1/day-07.md) | **Week 1 checkpoint** — E2E smoke test | apps/api | ✅ |
| 8 | [day-08.md](phase-1/day-08.md) | `GitProvider` seam + `GitHubProvider` (fetch PR diff/metadata) | @harness/git-provider | ✅ |
| 9 | [day-09.md](phase-1/day-09.md) | `TicketProvider` seam + `JiraProvider` (fetch issue) | @harness/ticket-provider | ✅ |
| 10 | [day-10.md](phase-1/day-10.md) | `LLMProvider` seam + `OpenAICompatibleProvider` + MockLLM | @harness/agent-runtime | ⚠️ |
| 11 | [day-11.md](phase-1/day-11.md) | `ReviewAgent` — structured ReviewAgentOutput (report + findings + suggestions) | @harness/agent-runtime | ✅ |
| 12 | [day-12.md](phase-1/day-12.md) | `ReviewIngestService` — parse PR URL → fetch → create task (CANCELLED) → review → persist | apps/api | ✅ |
| 13 | [day-13.md](phase-1/day-13.md) | `POST/GET /api/reviews` + decision route | apps/api | ✅ |
| 14 | [day-14.md](phase-1/day-14.md) | **Week 2 checkpoint** — review vertical slice (GitHub + real/mock LLM) | root | ✅ |
| 15 | [day-15.md](phase-1/day-15.md) | Verification Engine: request handler + compile check (`CompileCheck`) | @harness/verification-engine | ✅ |
| 16 | [day-16.md](phase-1/day-16.md) | Test executor, timeouts, flaky handling (`TestCheck`) | @harness/verification-engine | ⚠️ |
| 17 | [day-17.md](phase-1/day-17.md) | Evidence storage + provenance linking + diff engine | @harness/verification-engine | ⚠️ |
| 18 | [day-18.md](phase-1/day-18.md) | Attention Engine scoring (Risk/Impact/Novelty/Complexity/Confidence) | @harness/attention-engine | ⚠️ |
| 19 | [day-19.md](phase-1/day-19.md) | AttentionPolicy rules + routing (REVIEW_REQUIRED vs AUTO_APPROVABLE) | @harness/attention-engine | ⚠️ |
| 20 | [day-20.md](phase-1/day-20.md) | Context Engine: collect → rank → budget (for the reviewer) | @harness/context-engine | ⚠️ |
| 21 | [day-21.md](phase-1/day-21.md) | **Week 3 checkpoint** — context delivery, freshness check | @harness/context-engine | ⚠️ |
| 22 | [day-22.md](phase-1/day-22.md) | Review UI: queue + diff view + AI report & fix-suggestions panels | apps/web | ⚠️ |
| 23 | [day-23.md](phase-1/day-23.md) | E2E vertical slice — happy path (PR → report → decision) | apps/api | ⚠️ |
| 24 | [day-24.md](phase-1/day-24.md) | E2E — failure paths + provenance query UI | apps/api | ⚠️ |
| 25 | [day-25.md](phase-1/day-25.md) | Observability: logs, correlation IDs, audit queries | apps/api | ⚠️ |
| 26 | [day-26.md](phase-1/day-26.md) | Hardening: concurrency, failure injection, load smoke | apps/api | ⚠️ |
| 27 | [day-27.md](phase-1/day-27.md) | Provider config hygiene: token redaction, sanitized env, no live keys | apps/api | ⚠️ |
| 28 | [day-28.md](phase-1/day-28.md) | Documentation: specs → v0.2, dev guide, runbook | docs | ✅ |
| 29 | [day-29.md](phase-1/day-29.md) | **Final demo + retrospective** | root | ✅ |
| 30 | [day-30.md](phase-1/day-30.md) | **Tag `v0.1.0-harness` + Phase 2 backlog** | root | ✅ |

### Phase 1 Exit Criteria (Day 30)

Phase 1 is complete and tagged `v0.1.0-harness`. Review is driven through the
review API (the web UI calls the same endpoints). One criterion is honestly
**not met** — coverage was never measurable — and is the first Phase-2 backlog
item (see the [retro](../retros/phase-1.md)).

- [x] `docker compose up && pnpm dev` starts the whole system with one fixture provider config.
- [x] Scripted demo: paste PR URL → fetch diff → AI review (report + findings + suggestions) → verified → scored → reviewed → decision, with provenance chain queryable end-to-end.
- [x] Reject path demo: verification failure → flagged in report → decision recorded.
- [ ] All packages ≥ 70% line coverage on core logic — **not measured** (no coverage tooling); backlogged.
- [x] Specs updated to v0.2 reflecting as-built reality; known gaps documented as Phase 2 backlog.
- [x] Spec 9 (Memory/Evidence) preserved: evidence store is append-only and queryable end-to-end.
- [x] Spec 11 (Evaluation Engine) left as a Phase-2 seam only.

---

## Phase 2 — Calibrate & Secure the Review Pipeline

**Goal:** Phase 1 proved the review loop but is **unmeasured and uncalibrated**: the Attention weights are explicit placeholders, the Context ranker is keyword-only, auth is a single `X-Reviewer-Id` header, and the `AUTO_APPROVABLE` flag nobody acts on.

Phase 2's job is to **close the measurement loop**:

```
              ┌────────────────────────────────────────────┐
              │  Phase 1 result: review pipeline runs,      │
              │  evidence collected, but nobody can say     │
              │  how well the routing/scoring works.        │
              └───────────────────────┬────────────────────┘
                                      ▼
    Evaluate (offline metrics + A/B shadow harness)
         → Calibrate (fit Attention weights from real `was_useful`)
         → (auto-approve gated behind the calibration threshold)
         → Semantic infra installed as a *shadow* upgrade path
         → Identity + observability + governance promoted to contracts
```

By the end of Phase 2, the review pipeline is **measured**: metrics exist for routing precision/recall, Attention weights are fitted from real data, and the evaluation harness can compare two pipeline variants head-to-head.

**Explicitly out of scope for Phase 2:**
- Semantic retrieval is **installed but not default** (shadow mode behind the `Ranker` seam; hybrid default is Phase 3).
- Full Memory/Evidence subsystem (versioned write-back, consolidation/decay, decision memory) — Phase 3.
- Targeted/incremental verification (dependency graph) — Phase 3.
- Write-back to PR/Jira + provider breadth (GitLab/Bitbucket) — Phase 3.
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
| Object store | **S3/MinIO** for large diffs/artifacts (content-addressed) | Spec 5 §4.2 |
| Evaluation | Offline metrics + **shadow A/B harness** (review replay) | Spec 11 §5 |
| Sandbox | **Container** isolation for verification (clone → test) | Spec 7 §5.5 |

> **Invariant preserved:** still a modular monolith, still Postgres-centric, still `IEventBus`. Phase 2 only widens infrastructure *behind* the seams declared in Phase 1 (`Ranker`, `Retriever`, `Embedder`, `ContentStore`, `LLMProvider`). No engine imports another engine.

### Repository / Architecture Delta

```text
packages/
├── auth/                 # OIDC login, sessions, reviewer role enforcement  (NEW)
├── observability/        # OTel spans, metrics registry, audit queries      (NEW)
├── evaluation/           # metrics computation, reports, A/B shadow harness  (NEW)
├── embeddings/           # Embedder interface + provider adapter              (NEW)
├── object-store/         # S3/MinIO-backed ContentStore                       (NEW)
├── sandbox/              # Docker isolation for verification                  (NEW)
└── ... (existing packages unchanged; context-engine gains semantic shadow path)
```

Existing packages gain: `context-engine` (semantic retriever in shadow, exact tokenizer, cache), `attention-engine` (calibrated weights + adaptive thresholds), `review` (behind `auth/`), `db` (pgvector + object-store + auth schema migrations).

### Weekly Milestones

| Week | Theme | Milestone (demo-able at week's end) |
|------|-------|-------------------------------------|
| **W1 (D1–5)** | Identity & observability | SSO login, reviewer roles enforced; trace + metrics on a live run; `correlation_id` ↔ `trace_id` |
| **W2 (D6–10)** | Evaluation v0 + Spec 10 | Offline metrics report from real event/decision log; A/B shadow harness replays a recorded review |
| **W3 (D11–15)** | Calibrate & gate auto-approve | Attention weights fitted from `was_useful`; adaptive thresholds; auto-approve behind flag + sampling audit |
| **W4 (D16–20)** | Semantic infra (shadow) | pgvector + Embedder populated; semantic rank computed *without* changing the default ranker; exact tokenizer + context cache |
| **W5 (D21–25)** | Sandbox, object store, Spec 8 | Container sandbox for verify; large diffs in object store; Spec 8 promoted |
| **W6 (D26–30)** | Harden + exit review | Failure injection on new infra; E2E under Phase-2 stack; Phase 2→3 exit criteria met |

### Daily Breakdown

| N | Day file | Focus | Package |
|---|----------|-------|---------|
| 1 | [day-01.md](phase-2/day-01.md) | AuthN — OIDC SSO login, session/JWT, user identity model | @harness/auth |
| 2 | [day-02.md](phase-2/day-02.md) | AuthZ — reviewer roles, enforce on review/decision endpoints, identity on audit log | @harness/auth |
| 3 | [day-03.md](phase-2/day-03.md) | OpenTelemetry — spans across API/engines, trace_id ↔ correlation_id | @harness/observability |
| 4 | [day-04.md](phase-2/day-04.md) | Metrics — routing precision/recall, review dwell, usefulness counters; endpoints + dashboards | @harness/observability |
| 5 | [day-05.md](phase-2/day-05.md) | **Week 1 checkpoint** — identity + observability demonstrable | root |
| 6 | [day-06.md](phase-2/day-06.md) | Evaluation metrics — compute routing precision/recall + attention efficiency offline | @harness/evaluation |
| 7 | [day-07.md](phase-2/day-07.md) | Report generator — scheduled metrics report + trends | @harness/evaluation |
| 8 | [day-08.md](phase-2/day-08.md) | Review replay engine — replay a recorded review (Spec 11 §5) | @harness/evaluation |
| 9 | [day-09.md](phase-2/day-09.md) | A/B shadow harness — run two review-routing variants side-by-side, zero production effect | @harness/evaluation |
| 10 | [day-10.md](phase-2/day-10.md) | **Promote Spec 10** (Observability/Governance) + metrics checkpoint | root |
| 11 | [day-11.md](phase-2/day-11.md) | Calibration dataset — extract `was_useful` + assessment + outcome into fit set | @harness/attention-engine |
| 12 | [day-12.md](phase-2/day-12.md) | Weight fitting — fit Attention weights; train/validation split; inflation-monitor before/after | @harness/attention-engine |
| 13 | [day-13.md](phase-2/day-13.md) | Adaptive thresholds + alert-fatigue monitor from real data (Spec 6 §4.1) | @harness/attention-engine |
| 14 | [day-14.md](phase-2/day-14.md) | Auto-approve behind flag — `AUTO_APPROVABLE` path + kill-switch + sampling audit, gated on calibration | @harness/attention-engine |
| 15 | [day-15.md](phase-2/day-15.md) | **Week 3 checkpoint** — before/after calibration + auto-approve flag demo | root |
| 16 | [day-16.md](phase-2/day-16.md) | pgvector migration + `Embedder` interface + provider adapter | @harness/embeddings |
| 17 | [day-17.md](phase-2/day-17.md) | Index population — embed sources/diffs; re-embed on change | @harness/embeddings |
| 18 | [day-18.md](phase-2/day-18.md) | Semantic retriever behind `Retriever`/`Ranker` seam — shadow (log, don't default) | @harness/context-engine |
| 19 | [day-19.md](phase-2/day-19.md) | Exact tokenizer (tiktoken/provider) replaces `chars/4`; budget trimmer update | @harness/context-engine |
| 20 | [day-20.md](phase-2/day-20.md) | Context cache (`source_id + content_hash`) + TTL/invalidate + freshness | @harness/context-engine |
| 21 | [day-21.md](phase-2/day-21.md) | Object store (S3/MinIO) — `ContentStore` seam for large diffs (Spec 5 §4.2) | @harness/object-store |
| 22 | [day-22.md](phase-2/day-22.md) | Container sandbox for verification (Spec 7 §5.5) | @harness/sandbox |
| 23 | [day-23.md](phase-2/day-23.md) | Review-report storage + large-diff handling behind `ContentStore` | @harness/object-store |
| 24 | [day-24.md](phase-2/day-24.md) | **Promote Spec 8** (Human Review Interface) to standalone spec | root |
| 25 | [day-25.md](phase-2/day-25.md) | **Week 5 checkpoint** — sandbox + object store + cache integrated; shadow metrics in report | root |
| 26 | [day-26.md](phase-2/day-26.md) | Hardening — failure injection on vector/object-store/sandbox, concurrency | root |
| 27 | [day-27.md](phase-2/day-27.md) | E2E under Phase-2 infra — full review pipeline passes with auth + sandbox + metrics | root |
| 28 | [day-28.md](phase-2/day-28.md) | Docs — specs to v0.3 where changed; dev guide + runbook update | docs |
| 29 | [day-29.md](phase-2/day-29.md) | A/B dry-run end-to-end — compare two context-ranking variants head-to-head | root |
| 30 | [day-30.md](phase-2/day-30.md) | **Phase 2→3 exit review** — metrics checkpoint, Phase 3 backlog, tag `v0.2.0-harness` | root |

### Phase 2 Exit Criteria (Phase 2 → 3)

Phase 2 is complete and tagged `v0.2.0-harness`. Eight of nine criteria are met;
the one honest gap is that the fitted attention weights did *not* beat the
Phase-1 placeholder (log-loss 0.316 vs 0.262), so the placeholder stays — see the
[metrics checkpoint](../retros/phase2-metrics.md).

- [x] Routing precision/recall metrics computed and reviewed against a real decision log — precision 0.333 / recall 0.5 / escalation-leakage 1.0 (N=4).
- [ ] Attention weights fitted from real `was_useful` data; inflation-monitor shows improvement over placeholders — **fitted, not improved** (held back to the placeholder).
- [x] A/B shadow harness replays a recorded review and reports a head-to-head comparison with no production effect — day-29 `rank_correlation = [-1.0, -1.0]`, guardrail HELD.
- [x] Semantic infra (pgvector + Embedder) live in **shadow**: `rank_method` column retains `keyword` as default; semantic rank is logged and measurable via the harness.
- [x] SSO/OIDC login + reviewer roles enforced; audit trail carries real identity.
- [x] Auto-approve enabled only behind a flag + sampling audit, gated on the calibration threshold — flag OFF at rest, kill-switch armed.
- [x] Spec 8 (Human Review Interface) and Spec 10 (Observability/Governance) promoted to standalone specs.
- [x] Container sandbox for verification demonstrable; large diffs stored via `ContentStore`.
- [x] `pnpm test && pnpm lint && pnpm e2e` green under the full Phase-2 stack.

---

## Phase 3 — Breadth, Write-back & Close the Loop

**Goal:** Phase 2 measured the review pipeline. Phase 3 **closes the learning loop** — the *Learning* step of the critical milestone (Architecture §24.3) becomes a real subsystem, and the review product gains the breadth a real team needs:

```
                    ┌────────────────────────────────────────────┐
Phase 2 result     │  Review pipeline measured; still: GitHub-only │
                   │  provider, no write-back, no review memory,  │
                   │  full-suite verification, weights un-won     │
                    └───────────────┬───────────────────────────┘
                                    ▼
    Provider breadth → Write-back → Review memory → Review-quality calibration
                                    │
                                    ▼
                     Learning step closes the loop automatically
```

Concretely, Phase 3 delivers the subsystems that Phase 1 deferred and Phase 2 only seamed:

1. **Provider breadth** — `GitLabProvider` + `BitbucketProvider` beside `GitHubProvider`; hardened `JiraProvider`.
2. **Write-back** — `WriteBackService` (comment/label/status → PR/MR, comment/transition → Jira) behind a per-provider toggle, with `writeback_log` audit.
3. **Verification breadth** — clone PR into the sandbox worktree → run build/test in Docker → publish evidence; FAILED flags the report rather than blocking.
4. **Review memory** — past reviews/findings/decisions distilled, retrieved, and injected into the next review's context + attention.
5. **Review-quality calibration** — LLM-as-judge on review reports (severity/routing agreement), feeding `was_useful` into attention-weight fitting.
6. **Hybrid context ranking as default** — BM25 + embeddings + RRF + re-rank for the reviewer's context.
7. **The closed loop** — review decisions and judge signals feed back into calibration and routing automatically.

**Explicitly out of scope (non-goals, restated):**
- Full microservices / K8s migration — the system stays a modular monolith.
- AI writing or committing code — the reviewer remains read-only; write-back is *commentary/status*, never a code change.
- Autonomous decision-making that removes the human from the APPROVE/REJECT gate (`AUTO_APPROVABLE` remains the only auto-path, still sampled).
- GraphRAG / knowledge-graph over the codebase before the SQL dependency graph is proven.

### Tech Stack Delta over Phase 2

| Layer | Change | Anchor |
|-------|--------|--------|
| Git providers | `GitLabProvider`, `BitbucketProvider` (REST over `fetch`) | git-provider §2 |
| Ticket providers | Harden `JiraProvider`; add transition/comments | ticket-provider §2 |
| Write-back | `WriteBackService` (comment/label/status, Jira comment/transition) behind toggle | reviews route |
| Code index | **tree-sitter** symbol index + dependency graph in Postgres | Spec 7 §5.2–5.3 |
| Retrieval | Hybrid (BM25 + embeddings) + RRF + re-rank → **default**; optional **RAG Fusion** | Context §5.1–5.2 |
| Memory | Review-memory tiers + write-back + consolidation / decay / archive (Postgres) | Memory §3–4 |
| Judge | LLM-as-judge behind `LLMProvider` (rubric-scored, audited) | Spec 11 §5.1 |
| Queue *(optional)* | Durable queue (Redis/SQS) replacing in-process hand-off | Spec 2 §6 |

> **Invariant preserved:** durable queue is a *transport* swap behind `IEventBus` — the event contract does not change. Engines still never import each other. The AI never authors code.

### Repository / Architecture Delta

```text
packages/
├── memory/               # review-memory tiers, retrieval, write-back, lifecycle  (NEW)
├── code-index/           # tree-sitter symbol index + dependency graph           (NEW)
├── judge/                # LLM-as-judge rubric scoring behind LLMProvider         (NEW)
├── benchmark/            # review-quality corpus runtime                          (NEW)
└── ... (git-provider gains GitLab/Bitbucket; ticket-provider hardened; api gains WriteBackService)
```

Existing packages gain: `context-engine` (hybrid default, RRF re-rank, RAG Fusion), `verification-engine` (dependency-graph targeted verification, sandbox clone), `attention-engine` (review-memory + judge signals into scoring), `db` (writeback_log + review-memory schema).

### Weekly Milestones

| Week | Theme | Milestone (demo-able at week's end) |
|------|-------|-------------------------------------|
| **W1 (D1–5)** | Provider breadth | GitLab + Bitbucket `GitProvider` impls; hardened JiraProvider; fetch PR/MR from all three + Jira issue |
| **W2 (D6–10)** | Write-back | `WriteBackService` (PR comment/label/status, Jira comment/transition) behind toggle; `writeback_log` audit |
| **W3 (D11–15)** | Verification breadth | Clone PR into sandbox → build/test in Docker; FAILED flags report; evidence stored |
| **W4 (D16–20)** | Review memory | Review-memory tiers written from evidence + read back with relevance scoring |
| **W5 (D21–25)** | Review-quality calibration | LLM-as-judge on reports (severity/routing agreement); `was_useful` → weight fitting |
| **W6 (D26–30)** | Hybrid context default | BM25 + embeddings + RRF + re-rank default; RAG Fusion behind `Retriever` |
| **W7 (D31–35)** | Close the loop | Review decisions + judge → calibration → routing autonomously; durable-queue swap safe |
| **W8 (D36–40)** | Harden + exit | Write-back idempotency, token redaction, multi-provider concurrency; final docs + exit |

### Daily Breakdown

| N | Day file | Focus | Package |
|---|----------|-------|---------|
| 1 | [day-01.md](phase-3/day-01.md) | `GitLabProvider` — REST adapter for GitLab MR fetch | @harness/git-provider |
| 2 | [day-02.md](phase-3/day-02.md) | `BitbucketProvider` — REST adapter for Bitbucket PR fetch | @harness/git-provider |
| 3 | [day-03.md](phase-3/day-03.md) | Provider registry + `provider_configs` (redacted) resolution | @harness/git-provider |
| 4 | [day-04.md](phase-3/day-04.md) | Harden `JiraProvider` — comments + transition beside fetch | @harness/ticket-provider |
| 5 | [day-05.md](phase-3/day-05.md) | **Week 1 checkpoint** — fetch PR/MR from all three providers + Jira | root |
| 6 | [day-06.md](phase-3/day-06.md) | `WriteBackService` interface + GitHub comment/status impl | @harness/writeback (or api) |
| 7 | [day-07.md](phase-3/day-07.md) | Write-back for GitLab/Bitbucket + Jira transition | @harness/writeback |
| 8 | [day-08.md](phase-3/day-08.md) | `writeback_log` audit + idempotency (no duplicate comments) | @harness/db |
| 9 | [day-09.md](phase-3/day-09.md) | Write-back toggle at review-decision time; OFF = nothing external | apps/api |
| 10 | [day-10.md](phase-3/day-10.md) | **Week 2 checkpoint** — approve → comment lands (toggle ON); OFF → no-op | root |
| 11 | [day-11.md](phase-3/day-11.md) | Clone PR into sandbox worktree (`GitProvider.cloneAndCheckout`) | @harness/git-provider |
| 12 | [day-12.md](phase-3/day-12.md) | Run build/test in Docker sandbox against the clone | @harness/verification-engine |
| 13 | [day-13.md](phase-3/day-13.md) | FAILED → flag in report (not blocking); evidence stored | @harness/verification-engine |
| 14 | [day-14.md](phase-3/day-14.md) | Targeted/incremental verification via dependency graph | @harness/verification-engine |
| 15 | [day-15.md](phase-3/day-15.md) | **Week 3 checkpoint** — real PR tests in sandbox, faster + still correct | root |
| 16 | [day-16.md](phase-3/day-16.md) | Review-memory model — reviews/findings/decisions tiers (Spec 9) | @harness/memory |
| 17 | [day-17.md](phase-3/day-17.md) | Memory ingestion — evidence → distillation → versioned append | @harness/memory |
| 18 | [day-18.md](phase-3/day-18.md) | Memory retrieval — relevance scoring, served to Context | @harness/memory |
| 19 | [day-19.md](phase-3/day-19.md) | Memory lifecycle — consolidation/decay/archive | @harness/memory |
| 20 | [day-20.md](phase-3/day-20.md) | **Week 4 checkpoint** — review memory write + read demonstrable | root |
| 21 | [day-21.md](phase-3/day-21.md) | LLM-as-judge on review reports — severity/routing rubric | @harness/judge |
| 22 | [day-22.md](phase-3/day-22.md) | Inter-judge agreement + audit trail | @harness/judge |
| 23 | [day-23.md](phase-3/day-23.md) | Judge signals → attention-weight fitting (`was_useful`) | @harness/attention-engine |
| 24 | [day-24.md](phase-3/day-24.md) | Review-quality corpus — versioned gold labels | @harness/benchmark |
| 25 | [day-25.md](phase-3/day-25.md) | **Week 5 checkpoint** — judge + calibration run end-to-end | root |
| 26 | [day-26.md](phase-3/day-26.md) | Hybrid retriever default — BM25 + embeddings fused | @harness/context-engine |
| 27 | [day-27.md](phase-3/day-27.md) | RRF fusion + re-rank (dependency/recency/usage) | @harness/context-engine |
| 28 | [day-28.md](phase-3/day-28.md) | RAG Fusion behind `Retriever` | @harness/context-engine |
| 29 | [day-29.md](phase-3/day-29.md) | Hybrid default cutover; A/B vs shadow baseline | @harness/context-engine |
| 30 | [day-30.md](phase-3/day-30.md) | **Week 6 checkpoint** — hybrid default; shadow→default clean | root |
| 31 | [day-31.md](phase-3/day-31.md) | Learning pipeline — review decisions → calibration update (automated) | root |
| 32 | [day-32.md](phase-3/day-32.md) | Feedback into context ranking — learn from usefulness | @harness/context-engine |
| 33 | [day-33.md](phase-3/day-33.md) | Closed loop wiring — Evaluate → Calibrate → Deploy → Observe | root |
| 34 | [day-34.md](phase-3/day-34.md) | Durable queue (Redis/SQS) behind `IEventBus` (optional) | @harness/orchestrator |
| 35 | [day-35.md](phase-3/day-35.md) | **Week 7 checkpoint** — closed loop demonstrable | root |
| 36 | [day-36.md](phase-3/day-36.md) | Hardening — write-back idempotency, token redaction, multi-provider concurrency | root |
| 37 | [day-37.md](phase-3/day-37.md) | E2E full system under Phase-3 infra + load profile | root |
| 38 | [day-38.md](phase-3/day-38.md) | Docs — specs to v1.0 candidates, runbook + dev guide | docs |
| 39 | [day-39.md](phase-3/day-39.md) | Benchmark regression + judge-agreement report | root |
| 40 | [day-40.md](phase-3/day-40.md) | **Phase-3 exit review** — Learning closed + demonstrable; tag release | root |

### Phase 3 Exit Criteria

- [ ] The *Learning* step closes automatically: review decisions and judge signals feed back into calibration and routing.
- [ ] Provider breadth: GitHub, GitLab, Bitbucket fetch PR/MR; Jira fetch/search/comment/transition — all behind `provider_configs` with redacted tokens.
- [ ] Write-back (comment/label/status, Jira transition) works behind a toggle; `writeback_log` records every external write; OFF = nothing external.
- [ ] Verification breadth: clone + sandbox build/test demonstrable; targeted verification reduces latency with no correctness regression; FAILED flags the report.
- [ ] Review memory: write-back, consolidation, decay, archive, relevance-scored retrieval all live; past outcomes surface to Attention/context.
- [ ] Hybrid context ranking (BM25 + embeddings + RRF + re-rank) is the default; RAG Fusion optional behind `Retriever`.
- [ ] LLM-as-judge (rubric-scored, audited) producing quality signals used by ranking/calibration, with demonstrated inter-judge agreement.
- [ ] `pnpm test && pnpm lint && pnpm e2e` green under the full Phase-3 stack; closed-loop job runs end-to-end autonomously.

---

## How to Use This Plan

1. **One file per day**, authored at kickoff in the same format as `phase-1/day-NN.md`.
2. **Checkpoints are non-negotiable** — stop feature work, make the week's slice demonstrable, fix integration debt immediately.
3. **Every Phase-2 addition hangs off a Phase-1 seam.** If a change requires editing an engine's *internal* contract (not its interface), stop and reassess.
4. **Shadow-then-default is the standing rule** for semantic retrieval in Phase 2; resolved in Phase 3 by A/B win.
5. **Calibration gates auto-approve** in Phase 2 — confidence without evidence is the exact failure this system exists to prevent.
6. **The AI reviewer stays read-only.** Write-back is commentary/status, never a code change; the human APPROVE/REJECT gate is untouched except for the already-gated auto-approve path.
7. **AI never becomes authority** — critique/verification/attention augment the human decision; no automaton authors or commits code.