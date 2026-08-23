# HAI Harness — Phase 3: MCP Connectivity, Write-back & Close the Loop

**Version:** v0.3 (re-authored under `review-reorient` — MCP connectivity)
**Created:** 2026-08-20
**Status:** ✅ **Complete** — tagged `v0.3.0-harness` (exit review: `docs/retros/phase3-exit-review.md`)
**Prerequisite:** Phase 2 complete (`docs/plan/phase-2/`), review pipeline measured, weights fitted, A/B shadow harness live, `v0.2.0-harness` tagged.
**Specs:** `docs/core/1..7, 9, 11` (+ promoted Spec 8, Spec 10 from Phase 2).

---

## 1. Goal of the Phase

Phase 2 measured the review pipeline. Phase 3 **closes the learning loop** — the *Learning* step of the critical milestone (Architecture §24.3) becomes a real subsystem, and the review product gains the breadth a real team needs:

```text
                    ┌────────────────────────────────────────────┐
Phase 2 result     │  Review pipeline measured; still: GitHub-only │
                   │  provider, no write-back, no review memory,  │
                   │  full-suite verification, weights un-won     │
                    └───────────────┬───────────────────────────┘
                                    ▼
     MCP connectivity → Write-back → Review memory → Review-quality calibration
                                    │
                                    ▼
                     Learning step closes the loop automatically
```

Concretely, Phase 3 delivers the subsystems that Phase 1 deferred and Phase 2 only seamed:

1. **MCP connectivity** — connect GitHub, GitLab, Bitbucket **and** Jira through the **Model Context Protocol** with a single `@harness/mcp` client and **one config file** (`mcp.config.json`). The ecosystem already ships an MCP server for each of these; the harness **does not build per-provider REST adapters** — it fronts whatever MCP server is listed in the config.
2. **Write-back** — `WriteBackService` (comment/label/status → PR/MR, comment/transition → Jira) behind a per-provider toggle, with `writeback_log` audit; the writes go through the same MCP tools already connected above.
3. **Verification breadth** — clone PR into the sandbox worktree → run build/test in Docker → publish evidence; FAILED flags the report rather than blocking.
4. **Review memory** — past reviews/findings/decisions distilled, retrieved, and injected into the next review's context + attention.
5. **Review-quality calibration** — LLM-as-judge on review reports (severity/routing agreement), feeding `was_useful` into attention-weight fitting.
6. **Hybrid context ranking as default** — BM25 + embeddings + RRF + re-rank for the reviewer's context.
7. **The closed loop** — review decisions and judge signals feed back into calibration and routing automatically.

> **AI model connection is unchanged.** The AI provider is still configured the way it always was — **api key + provider + base URL + model** (`provider_configs` row, `kind = 'ai'`, behind the existing `LLMProvider` seam). MCP replaces only the *Git/ticket tool* layer, never the model layer.

### Explicitly out of scope (non-goals, restated)

- Building our own GitHub/GitLab/Bitbucket/Jira REST SDKs — the MCP servers already exist; we write the client + config, not the integrations.
- Full microservices / K8s migration — the system stays a modular monolith.
- AI writing or committing code — the reviewer remains read-only; write-back is *commentary/status*, never a code change.
- Autonomous decision-making that removes the human from the APPROVE/REJECT gate (`AUTO_APPROVABLE` remains the only auto-path, still sampled).
- GraphRAG / knowledge-graph over the codebase before the SQL dependency graph is proven.

---

## 2. Sizing Rationale

**Estimate: 40 working days (8 weeks).** Phase 3 has more *net-new* subsystems than Phase 1 or 2 (MCP connectivity, write-back, review memory, code index, judge, benchmark, closed loop) but none requires inventing a new seam — every one plugs into an interface Phase 1 declared or Phase 2 installed. The 8-week shape is four 2-week arcs: MCP-connectivity → write-back, verification-breadth → review-memory, review-quality → hybrid-default, then closed-loop → harden.

The **MCP switch makes provider breadth cheap**: adding a Git host or ticket system becomes a config entry, not a new adapter package. That frees Week 1 to also land write-back's write primitives, which Phase 1 had priced as a full separate week.

---

## 3. Tech Stack — Delta over Phase 2

| Layer | Change | Anchor |
|-------|--------|--------|
| Git providers | **MCP only** — `@harness/mcp` client (stdio + SSE/HTTP) fronts GitHub/GitLab/Bitbucket MCP servers; no REST SDKs | git-provider §2 |
| Ticket providers | **MCP only** — Jira via its MCP server; fetch/search/comment/transition are MCP tool calls | ticket-provider §2 |
| MCP config | **one file** — `mcp.config.json` declares the servers + token env refs (no inline tokens) | new |
| AI model | **unchanged** — api key + provider + base URL + model (`provider_configs`, `kind='ai'`) | agent-runtime §2 |
| Write-back | `WriteBackService` (comment/label/status, Jira comment/transition) behind toggle — executed via MCP tools | reviews route |
| Code index | **tree-sitter** symbol index + dependency graph in Postgres | Spec 7 §5.2–5.3 |
| Retrieval | Hybrid (BM25 + embeddings) + RRF + re-rank → **default**; optional **RAG Fusion** | Context §5.1–5.2 |
| Memory | Review-memory tiers + write-back + consolidation / decay / archive (Postgres) | Memory §3–4 |
| Judge | LLM-as-judge behind `LLMProvider` (rubric-scored, audited) | Spec 11 §5.1 |
| Queue *(optional)* | Durable queue (Redis/SQS) replacing in-process hand-off | Spec 2 §6 |

> **Invariant preserved:** durable queue is a *transport* swap behind `IEventBus` — the event contract does not change. Engines still never import each other. The AI never authors code. **MCP is the tool transport, not the model connection** — the AI provider contract (`key`+`baseUrl`+`model`) is untouched.

---

## 4. Repository / Architecture Delta

```text
packages/
├── mcp/                   # generic MCP client: stdio + SSE/HTTP, tools/list + tools/call  (NEW)
├── memory/                # review-memory tiers, retrieval, write-back, lifecycle          (NEW)
├── code-index/            # tree-sitter symbol index + dependency graph                    (NEW)
├── judge/                 # LLM-as-judge rubric scoring behind LLMProvider                  (NEW)
├── benchmark/             # review-quality corpus runtime                                   (NEW)
└── ... (git-provider + ticket-provider gain MCP-backed impls; api gains WriteBackService)

mcp.config.json            # the ONE file that connects GitHub/GitLab/Bitbucket/Jira MCP servers (repo root)
```

Existing packages gain: `git-provider` (an `MCPGitProvider` implemented against MCP tool calls, not host REST), `ticket-provider` (an `MCPTicketProvider` for Jira via MCP), `context-engine` (hybrid default, RRF re-rank, RAG Fusion), `verification-engine` (dependency-graph targeted verification, sandbox clone), `attention-engine` (review-memory + judge signals into scoring), `db` (writeback_log + review-memory schema).

---

## 5. Weekly Milestones

| Week | Theme | Milestone (demo-able at week's end) |
|------|-------|-------------------------------------|
| **W1 (D1–5)** | MCP connectivity | `@harness/mcp` client + `mcp.config.json`; fetch PR/MR from GitHub/GitLab/Bitbucket + a Jira issue, all through one config file (no per-host REST) |
| **W2 (D6–10)** | Write-back | `WriteBackService` (PR comment/label/status, Jira comment/transition) behind toggle; `writeback_log` audit — writes via the MCP tools already online |
| **W3 (D11–15)** | Verification breadth | Clone PR into sandbox → build/test in Docker; FAILED flags report; evidence stored |
| **W4 (D16–20)** | Review memory | Review-memory tiers written from evidence + read back with relevance scoring |
| **W5 (D21–25)** | Review-quality calibration | LLM-as-judge on reports (severity/routing agreement); `was_useful` → weight fitting |
| **W6 (D26–30)** | Hybrid context default | BM25 + embeddings + RRF + re-rank default; RAG Fusion behind `Retriever` |
| **W7 (D31–35)** | Close the loop | Review decisions + judge → calibration → routing autonomously; durable-queue swap safe |
| **W8 (D36–40)** | Harden + exit | Write-back idempotency, token redaction, multi-provider concurrency; final docs + exit |

---

## 6. Daily Files

Each day has its own file with objectives, tasks, deliverables, and acceptance criteria (authored at phase kickoff, same per-file granularity as Phase 1 and 2):

| N | Day file | Focus | Package |
|---|----------|-------|---------|
| 1 | [day-01.md](day-01.md) | `@harness/mcp` — generic MCP client (stdio + SSE/HTTP, `tools/list`, `tools/call`) | @harness/mcp |
| 2 | [day-02.md](day-02.md) | `mcp.config.json` — one file connecting GitHub/GitLab/Bitbucket/Jira MCP servers (token via env) | @harness/mcp |
| 3 | [day-03.md](day-03.md) | `MCPGitProvider` — Git MCP tool calls → `PullRequest` behind the `GitProvider` seam | @harness/git-provider |
| 4 | [day-04.md](day-04.md) | `MCPTicketProvider` — Jira MCP tool calls → `Issue` + comment/transition behind `TicketProvider` | @harness/ticket-provider |
| 5 | [day-05.md](day-05.md) | **Week 1 checkpoint** — fetch PR/MR from GitHub/GitLab/Bitbucket + Jira via one config | root |
| 6 | [day-06.md](day-06.md) | `WriteBackService` interface + MCP-backed comment/status impl | @harness/writeback (or api) |
| 7 | [day-07.md](day-07.md) | Write-back for GitLab/Bitbucket + Jira transition via MCP tools | @harness/writeback |
| 8 | [day-08.md](day-08.md) | `writeback_log` audit + idempotency (no duplicate comments) | @harness/db |
| 9 | [day-09.md](day-09.md) | Write-back toggle at review-decision time; OFF = nothing external | apps/api |
| 10 | [day-10.md](day-10.md) | **Week 2 checkpoint** — approve → comment lands (toggle ON); OFF → no-op | root |
| 11 | [day-11.md](day-11.md) | Clone PR into sandbox worktree (`GitProvider.cloneAndCheckout`) | @harness/git-provider |
| 12 | [day-12.md](day-12.md) | Run build/test in Docker sandbox against the clone | @harness/verification-engine |
| 13 | [day-13.md](day-13.md) | FAILED → flag in report (not blocking); evidence stored | @harness/verification-engine |
| 14 | [day-14.md](day-14.md) | Targeted/incremental verification via dependency graph | @harness/verification-engine |
| 15 | [day-15.md](day-15.md) | **Week 3 checkpoint** — real PR tests in sandbox, faster + still correct | root |
| 16 | [day-16.md](day-16.md) | Review-memory model — reviews/findings/decisions tiers (Spec 9) | @harness/memory |
| 17 | [day-17.md](day-17.md) | Memory ingestion — evidence → distillation → versioned append | @harness/memory |
| 18 | [day-18.md](day-18.md) | Memory retrieval — relevance scoring, served to Context | @harness/memory |
| 19 | [day-19.md](day-19.md) | Memory lifecycle — consolidation/decay/archive | @harness/memory |
| 20 | [day-20.md](day-20.md) | **Week 4 checkpoint** — review memory write + read demonstrable | root |
| 21 | [day-21.md](day-21.md) | LLM-as-judge on review reports — severity/routing rubric | @harness/judge |
| 22 | [day-22.md](day-22.md) | Inter-judge agreement + audit trail | @harness/judge |
| 23 | [day-23.md](day-23.md) | Judge signals → attention-weight fitting (`was_useful`) | @harness/attention-engine |
| 24 | [day-24.md](day-24.md) | Review-quality corpus — versioned gold labels | @harness/benchmark |
| 25 | [day-25.md](day-25.md) | **Week 5 checkpoint** — judge + calibration run end-to-end | root |
| 26 | [day-26.md](day-26.md) | Hybrid retriever default — BM25 + embeddings fused | @harness/context-engine |
| 27 | [day-27.md](day-27.md) | RRF fusion + re-rank (dependency/recency/usage) | @harness/context-engine |
| 28 | [day-28.md](day-28.md) | RAG Fusion behind `Retriever` | @harness/context-engine |
| 29 | [day-29.md](day-29.md) | Hybrid default cutover; A/B vs shadow baseline | @harness/context-engine |
| 30 | [day-30.md](day-30.md) | **Week 6 checkpoint** — hybrid default; shadow→default clean | root |
| 31 | [day-31.md](day-31.md) | Learning pipeline — review decisions → calibration update (automated) | root |
| 32 | [day-32.md](day-32.md) | Feedback into context ranking — learn from usefulness | @harness/context-engine |
| 33 | [day-33.md](day-33.md) | Closed loop wiring — Evaluate → Calibrate → Deploy → Observe | root |
| 34 | [day-34.md](day-34.md) | Durable queue (Redis/SQS) behind `IEventBus` (optional) | @harness/orchestrator |
| 35 | [day-35.md](day-35.md) | **Week 7 checkpoint** — closed loop demonstrable | root |
| 36 | [day-36.md](day-36.md) | Hardening — write-back idempotency, token redaction, multi-provider concurrency | root |
| 37 | [day-37.md](day-37.md) | E2E full system under Phase-3 infra + load profile | root |
| 38 | [day-38.md](day-38.md) | Docs — specs to v1.0 candidates, runbook + dev guide | docs |
| 39 | [day-39.md](day-39.md) | Benchmark regression + judge-agreement report | root |
| 40 | [day-40.md](day-40.md) | **Phase-3 exit review** — Learning closed + demonstrable; tag release | root |

---

## 7. Exit Criteria (Phase 3, from Architecture §24.3)

- [x] The *Learning* step closes automatically: review decisions and judge signals feed back into calibration and routing.
- [x] MCP connectivity: GitHub, GitLab, Bitbucket fetch PR/MR; Jira fetch/search/comment/transition — **all through `@harness/mcp` + one `mcp.config.json`**, tokens referenced by env var (never inline), no per-host REST handler.
- [x] AI model connection remains **api key + provider + base URL + model** (`provider_configs`), unchanged from Phase 1/2.
- [x] Write-back (comment/label/status, Jira transition) works behind a toggle; `writeback_log` records every external write; OFF = nothing external.
- [x] Verification breadth: clone + sandbox build/test demonstrable; targeted verification reduces latency with no correctness regression; FAILED flags the report.
- [x] Review memory: write-back, consolidation, decay, archive, relevance-scored retrieval all live; past outcomes surface to Attention/context.
- [ ] Hybrid context ranking (BM25 + embeddings + RRF + re-rank) is the default; RAG Fusion optional behind `Retriever` — **not met**: Day-29 A/B HOLD, `keyword` stays default (carried-forward CF-1).
- [x] LLM-as-judge (rubric-scored, audited) producing quality signals used by ranking/calibration, with demonstrated inter-judge agreement.
- [x] `pnpm test && pnpm lint && pnpm e2e` green under the full Phase-3 stack; closed-loop job runs end-to-end autonomously.

> **Exit verdict: EXIT-WITH-CARRYFORWARD** (8 of 9 met). See
> [`docs/retros/phase3-exit-review.md`](../../retros/phase3-exit-review.md) for the
> full criteria table and the two carries (CF-1 hybrid default, CF-2 fitted-weight
> auto-apply).

---

## 8. How to Use This Plan

1. **One file per day**, authored at kickoff in the same format as `phase-1/day-NN.md` (Objectives / Design Decisions / Tasks / Deliverables / Acceptance Criteria / Notes).
2. **Checkpoints (D5, D10, D15, D20, D25, D30, D35) are non-negotiable** — stop feature work, make the week's slice demonstrable, fix integration debt immediately.
3. **Every Phase-3 addition hangs off a Phase-1/Phase-2 seam.** If a change requires editing an engine's *internal* contract (not its interface), stop and reassess.
4. **Each new default is won, not inherited.** Hybrid ranking and fitted weights earn default status by beating the Phase-2 baseline in the A/B harness (`eval:ab-report`) — never by being newer.
5. **The AI reviewer stays read-only.** Write-back is commentary/status, never a code change; the human APPROVE/REJECT gate is untouched except for the already-gated, sampling-audited `AUTO_APPROVABLE` path.
6. **MCP replaces tools, not models.** Git/ticket actions flow through the configured MCP servers; the AI provider stays `key`+`baseUrl`+`model`. We write one client + one config file and adopt the ecosystem's servers — we do not re-implement GitHub/GitLab/Bitbucket/Jira APIs.

---

*Prev phase: [Phase 2 — Calibrate & Secure the Review Pipeline](../phase-2/README.md)*