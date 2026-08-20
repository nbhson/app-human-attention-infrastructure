# HAI Harness — Phase 3 Implementation Plan

**Version:** v0.1
**Created:** 2026-08-20
**Prerequisite:** Phase 2 complete (`docs/plan/phase-2/`), pipeline measured, weights calibrated, A/B harness live, `v0.2.0-harness` tagged.
**Specs:** `docs/core/1..7, 9, 11` (+ promoted Spec 8, Spec 10 from Phase 2).

---

## 1. Goal of the Phase

Phase 2 measured the pipeline. Phase 3 **closes the learning loop** — the *Learning* step of the critical milestone (Architecture §24.3) becomes a real subsystem:

```text
AI Change → Evidence → Risk → Human Attention → Decision
                                                    ↓
                        Learning  ──────────────────┘  (closes here)
                          │
                          ▼
        Evaluate → Calibrate → Deploy → Observe → (repeat)
```

Concretely, Phase 3 delivers the subsystems that Phase 1 deferred and Phase 2 only seamed:

1. **Full Memory / Evidence** — retrieval, decision memory, project memory, versioned write-back, consolidation/decay/archive.
2. **Targeted / incremental verification** — dependency-graph-driven test selection (the p95 latency driver).
3. **Hybrid context ranking as default** — BM25 + embeddings + RRF + re-rank + RAG Fusion.
4. **Multi-agent orchestration** — bounded autonomous loops, critique/revision (augmenting, never replacing, human decision).
5. **Benchmark corpus + LLM-as-judge** — gold labels + rubric-scored, audited quality signals.
6. **The closed loop** — evaluation and review decisions feed back into calibration and context ranking automatically.

### Explicitly out of scope (non-goals, restated)

- Full microservices / K8s migration — the system stays a modular monolith.
- Autonomous decision-making that removes the human from the APPROVE/REJECT gate (multi-agent *bounded* loops only; `AUTO_APPROVABLE` remains the only auto-path, still sampled).
- GraphRAG / knowledge-graph over the codebase before the SQL dependency graph is proven.

---

## 2. Sizing Rationale

**Estimate: 40 working days (8 weeks).** Phase 3 has more *net-new* subsystems than Phase 1 or 2 (Memory, code index, multi-agent, benchmark, judge, closed loop) but none requires inventing a new seam — every one plugs into an interface Phase 1 declared or Phase 2 installed. The 8-week shape is two 2-week arcs (Memory → trajectory, then dependency-graph → hybrid) followed by a 2-week automation arc (multi-agent) and a 2-week closing arc (benchmark/judge → closed loop + hardening).

---

## 3. Tech Stack — Delta over Phase 2

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

---

## 4. Repository / Architecture Delta

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

---

## 5. Weekly Milestones

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

---

## 6. Daily Files

| Day | File | Focus |
|-----|------|-------|
| 1 | [day-01.md](day-01.md) | Memory model v2 — task/session/project/decision/failure/review tiers (Spec 9 §4.1) |
| 2 | [day-02.md](day-02.md) | Memory ingestion — evidence → distillation → versioned append-only writes |
| 3 | [day-03.md](day-03.md) | Memory retrieval — relevance scoring (`0.6·sim + 0.2·recency + 0.2·access`), served to Context |
| 4 | [day-04.md](day-04.md) | Versioned write-back — `supersedes`, Git-like log/rollback, forget/update cross-check (§4.4) |
| 5 | [day-05.md](day-05.md) | **Week 1 checkpoint** — memory write+read demonstrable |
| 6 | [day-06.md](day-06.md) | Consolidation — dedup (0.85), conflict strategy, decay (`0.99^days`) (§4.5) |
| 7 | [day-07.md](day-07.md) | Archive (90d) + expiration; hot/cold tier |
| 8 | [day-08.md](day-08.md) | Trajectory Fork — head-to-head model/prompt/context comparison (Spec 3 §6.1) |
| 9 | [day-09.md](day-09.md) | Trajectory Resume — crash recovery + mid-run replay (Spec 3 §6.1) |
| 10 | [day-10.md](day-10.md) | **Week 2 checkpoint** — consolidation/decay validated against decision log |
| 11 | [day-11.md](day-11.md) | tree-sitter symbol index — functions/classes/imports for target repo |
| 12 | [day-12.md](day-12.md) | Dependency graph build (file/module edges) in Postgres |
| 13 | [day-13.md](day-13.md) | Impact analysis — map a change to affected tests (transitive) |
| 14 | [day-14.md](day-14.md) | Targeted/incremental verification — run only affected tests via graph (Spec 7 §5.2–5.3) |
| 15 | [day-15.md](day-15.md) | **Week 3 checkpoint** — targeted verification faster + still correct |
| 16 | [day-16.md](day-16.md) | Hybrid retriever as default — BM25 lexical + embedding semantic fused |
| 17 | [day-17.md](day-17.md) | RRF fusion (k=60) + re-rank (dependency/recency/usage heuristics) |
| 18 | [day-18.md](day-18.md) | RAG Fusion (multi-query + reciprocal ranking) behind `Retriever` |
| 19 | [day-19.md](day-19.md) | Integrate hybrid default; `rank_method` cutover; A/B vs shadow baseline |
| 20 | [day-20.md](day-20.md) | **Week 4 checkpoint** — lost-in-middle + freshness under hybrid; shadow→default cutover clean |
| 21 | [day-21.md](day-21.md) | Multi-agent primitives — MapReduce / Critique-Revision / Ensemble |
| 22 | [day-22.md](day-22.md) | Bounded autonomous loops — max iterations, token budget, guardrails |
| 23 | [day-23.md](day-23.md) | Role taxonomy (Coder/Reviewer/Tester/Orchestrator) — AI review augments, never replaces human |
| 24 | [day-24.md](day-24.md) | Decomposer — 3-level hierarchical planning, Plan-and-Solve/ReWOO, dynamic replanning (Spec 2 §10) |
| 25 | [day-25.md](day-25.md) | **Week 5 checkpoint** — multi-agent demo + guardrail proofs |
| 26 | [day-26.md](day-26.md) | Benchmark corpus — versioned gold labels (SWE-bench-style tasks) |
| 27 | [day-27.md](day-27.md) | Benchmark runtime — Minimal Benchmark Harness container (bash + editor) (Spec 11 §5.1–5.2) |
| 28 | [day-28.md](day-28.md) | LLM-as-judge — rubric-scored behind `LLMProvider`, audited (Spec 11 §5.1) |
| 29 | [day-29.md](day-29.md) | Judge calibration + inter-judge agreement + audit trail |
| 30 | [day-30.md](day-30.md) | **Week 6 checkpoint** — benchmark + judge run end-to-end on corpus |
| 31 | [day-31.md](day-31.md) | Learning pipeline — evaluation results → calibration update (automated) |
| 32 | [day-32.md](day-32.md) | Feedback into context ranking — learn ranking params from usefulness |
| 33 | [day-33.md](day-33.md) | Closed loop wiring — Evaluate → Calibrate → Deploy → Observe runs continuously |
| 34 | [day-34.md](day-34.md) | Durable queue (Redis/SQS) behind `IEventBus` (contract unchanged; optional) (Spec 2 §6) |
| 35 | [day-35.md](day-35.md) | **Week 7 checkpoint** — closed loop demonstrable autonomously |
| 36 | [day-36.md](day-36.md) | Hardening — multi-agent runaway guards, memory growth, hybrid latency |
| 37 | [day-37.md](day-37.md) | E2E full system under Phase-3 infra + load profile |
| 38 | [day-38.md](day-38.md) | Docs — specs to v1.0 candidates, runbook + dev guide |
| 39 | [day-39.md](day-39.md) | Benchmark regression + judge-agreement report |
| 40 | [day-40.md](day-40.md) | **Phase-3 exit review** — Learning closed + demonstrable; tag release |

---

## 7. Exit Criteria (Phase 3, from Architecture §24.3)

- [ ] The *Learning* step closes automatically: evaluation results and review decisions feed back into calibration and context ranking.
- [ ] Targeted/incremental verification demonstrably reduces verify latency versus full-suite baseline, with no correctness regression on the golden suite.
- [ ] Hybrid context ranking (BM25 + embeddings + RRF + re-rank) is the default; RAG Fusion optional behind `Retriever`.
- [ ] Memory subsystem: write-back, consolidation, decay, archive, relevance-scored retrieval all live; decision memory surfaces past outcomes to Attention.
- [ ] Trajectory Fork/Resume demonstrable (head-to-head compare + crash recovery).
- [ ] Multi-agent loops run within hard budgets; every human-facing decision still routes through the human gate (or sampling-audited `AUTO_APPROVABLE`).
- [ ] Benchmark corpus (versioned gold labels) + LLM-as-judge (rubric-scored, audited) producing quality signals used by ranking/calibration.
- [ ] `pnpm test && pnpm lint && pnpm e2e` green under the full Phase-3 stack; closed-loop job runs end-to-end autonomously.

---

## 8. How to Use This Plan

1. **One file per day**, authored at kickoff in the same format as `phase-1/day-NN.md`.
2. **Checkpoints (D5, D10, D15, D20, D25, D30, D35) are non-negotiable.**
3. **Every automaton is bounded.** Multi-agent loops have iteration + token ceilings; runaway is a *failure mode to test*, not a feature to accept.
4. **AI never becomes authority.** Critique/revision augments Verification and Attention; the human APPROVE/REJECT gate is untouched except for the already-gated auto-approve path.
5. **Shadow-then-default is already resolved** by Phase 2's harness: hybrid ranking earns its default status by winning the A/B, not by being newer.

---

*Prev phase: [Phase 2 — Calibrate & Close the Measurement Loop](../phase-2/README.md)*