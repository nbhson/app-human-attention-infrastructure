# Fit Analysis — AI-coding-skills-framework/harness → HAI Harness

**Cross-reference:** `https://github.com/nbhson/knowledge-ai/tree/main/AI-coding-skills-framework/harness` (11 topical modules `01–11` + 4 specialized DeepSeek Harness files) ↔ **HAI (Human Attention Infrastructure)** architecture.

**Purpose:** Determine which techniques from the source framework are **fit** for HAI, where they fit (which spec), at which phase, which techniques have **already been absorbed**, and which are **not fit** — avoiding blind "take everything" adoption. The single filtering criterion: _does this technique help reduce the human attention needed to safely accept a change?_

---

## 0. Legend

| Verdict              | Meaning                                                                                        | Action                                |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Absorbed**         | Current spec already describes this technique (usually citing "adopted from the reference skills framework") | No further action                     |
| **Fit — to add**     | Valuable technique, not yet in spec                                                            | Added/being added to specific spec + phase |
| **Reference**        | Useful conceptually but not needed as a contract                                               | Noted, not required                   |
| **Not fit**          | Conflicts with HAI principles or diverges from goals                                           | Clear rejection reason recorded       |

---

## 1. Overview Map

| #   | Source technique (harness)                                                               | HAI subsystem               | Phase | Verdict                                             |
| --- | -------------------------------------------------------------------------------------- | --------------------------- | ----- | --------------------------------------------------- |
| 01  | retrieve-memory-knowledge (embedding/chunking/ANN/RAG/hybrid/BM25+RRF/GraphRAG/MemGPT) | Context (4), Memory (9)     | 3     | Absorbed (Context §5.1) + added (Memory)            |
| 02  | build-context (budget, lost-in-middle, 5-level, routing, RAG-Fusion, cache, validator) | Context (4)                 | 2–3   | Added (§5.2)                                        |
| 03  | update-memory-store (write-back, consolidate, VersionedMemory, Trajectory)             | Memory (9), Agent (3)       | 3     | Absorbed (§4.4, §6.1) + added (§4.5)                |
| 04  | plan-decompose-task (Plan-and-Solve/ToT/ReWOO/HTN/reflective)                          | Orchestrator (2)            | 3     | Added (Decomposer)                                  |
| 05  | prompt-builder (template, few-shot, guardrail, versioning)                             | Agent (3), Evaluation (11)  | 2–3   | Reference (versioning + guardrail)                  |
| 06  | decide-tools-mcp (tool registry, RBAC, rate-limit, Code Mode SDK)                      | Agent (3), Verification (7) | 2–3   | Added (RBAC/rate-limit/sandbox)                     |
| 07  | workflow (pipeline, saga, circuit-breaker, Cordis plugin)                              | Orchestrator (2)            | 2     | Added (saga + circuit-breaker)                      |
| 08  | task (classification, DAG, lifecycle, token budget)                                    | Orchestrator (2)            | —     | Covered (Spec 2)                                    |
| 09  | multi-agent (MapReduce/Debate/Critique/Ensemble)                                       | _(Phase 3)_                 | 3     | Added note (bounded loops)                          |
| 10  | automation (CI/CD, self-healing, guardrails, observability)                            | Observability (10)          | 2     | Reference → future spec 10                          |
| 11  | evaluate (rubric, LLM-as-judge, inter-judge agreement, gold-corpus, bias audit)        | Evaluation (11)             | 3     | Added (§5.1–5.2) + absorption (judge, rubric)       |

---

## 2. Detailed Mapping

### Module 01: retrieve-memory-knowledge

| Source concept                         | Absorption status                              | Reason                                                                                             |
| -------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Embedding (OpenAI, local)              | Absorbed (Context §5.1)                        | `Embedder` seam + `embedding_store` table; Phase 3 only                                            |
| Chunking / overlap / strategy          | Absorbed (Context §5.1)                        | Chunking strategy configurable; overlap parameterized                                              |
| ANN / vector index                     | Absorbed (Context §5.1)                        | PGVector in Phase 3; Phase 1 stays Postgres-only                                                   |
| RAG (retrieval-augmented generation)   | Absorbed (Context §5.1)                        | Retrieval pipeline: collect → embed → rank → trim → inject                                         |
| Hybrid search (BM25 + semantic)        | Added (Context §5.2)                           | `Ranker` seam; default = keyword; hybrid behind feature flag (Day-29 A/B HOLD → carry-forward)     |
| RAG-Fusion (multi-queue fusion)        | Added (Context §5.2)                           | Fusion combiner behind seam                                                                        |
| GraphRAG / MemGPT                      | Reference                                      | Interesting conceptually; out of scope for current phase                                           |

### Module 02: build-context

| Source concept                | Absorption status                              | Reason                                                                                         |
| ----------------------------  | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Context budget (token limit)  | Added (Context §5.2)                           | `ContextBudget` enforces token ceiling; OOM → trim → retry with smaller budget                  |
| Lost-in-the-middle mitigation | Added (Context §5.2)                          | Re-ordering strategy (front-load critical signals)                                              |
| Multi-level context (5-level) | Added (Context §5.2)                           | File → module → dependency graph → ticket → codebase                                             |
| Context routing               | Added (Context §5.2)                           | Route different context slices to different reviewer roles                                      |
| Cache                         | Added (Context §5.2)                           | Context cache keyed by change fingerprint                                                       |
| Validator                     | Added (Context §5.2)                           | Context quality gate before injecting into prompt                                               |

### Module 03: update-memory-store

| Source concept                  | Absorption status                              | Reason                                                                                        |
| ------------------------------  | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Write-back                      | Absorbed (Memory §4.4)                         | Write-back service with toggle + audit log                                                     |
| Consolidation                   | Added (Memory §4.5)                            | Background consolidation of redundant memories                                                 |
| VersionedMemory                 | Absorbed (Memory §4.4)                         | Memory entries are versioned; previous versions preserved                                      |
| Trajectory (append-only log)    | Absorbed (Agent §6.1)                          | Agent trajectory is append-only, replayable, forkable                                          |

### Module 04: plan-decompose-task

| Source concept           | Absorption status         | Reason                                                                                     |
| -----------------------  | ------------------------- | ------------------------------------------------------------------------------------------ |
| Plan-and-Solve           | Added (Orchestrator §7)   | Phase 3 Decomposer for complex PRs that need multi-step analysis                           |
| ToT (Tree of Thoughts)   | Added (Orchestrator §7)   | Branching exploration for high-risk changes                                                |
| ReWOO                    | Reference                 | Useful pattern; not a contract requirement                                                 |
| HTN                      | Reference                 | Hierarchical task networks; conceptual reference                                           |
| Reflective planning      | Added (Orchestrator §7)   | Self-reflection loop for edge-case decisions                                               |

### Module 05: prompt-builder

| Source concept       | Absorption status         | Reason                                                                                    |
| -------------------  | ------------------------- | ----------------------------------------------------------------------------------------- |
| Template engine      | Reference                 | Prompt templates are implementation detail; not a spec contract                           |
| Few-shot examples    | Reference                 | Useful pattern; handled at implementation level                                           |
| Guardrail            | Added (Agent §3)          | Prompt guardrails: input validation, output schema enforcement                            |
| Versioning           | Added (Agent §3)          | Prompt versioning for A/B testing and rollback                                            |

### Module 06: decide-tools-mcp

| Source concept         | Absorption status         | Reason                                                                                    |
| ---------------------  | ------------------------- | ----------------------------------------------------------------------------------------- |
| Tool registry          | Added (Agent §14)         | Centralized tool registry with capability declarations                                    |
| RBAC                   | Added (Agent §14)         | Role-based access control tiers for tool usage                                            |
| Rate limit             | Added (Agent §14)         | Per-tool and per-context rate limiting                                                    |
| Code Mode SDK          | Added (Verification §5.5) | Sandbox isolation for Agent §14 + Verification §5.5                                      |

### Module 07: workflow

| Source concept            | Absorption status         | Reason                                                                                    |
| ------------------------  | ------------------------- | ----------------------------------------------------------------------------------------- |
| Pipeline orchestration    | Absorbed (Orchestrator §2)| Task lifecycle state machine                                                              |
| Saga pattern              | Added (Orchestrator §7)   | Compensating transactions for multi-step operations                                       |
| Circuit breaker           | Added (Orchestrator §7)   | Fail-fast on downstream service degradation                                               |
| Cordis plugin system      | Reference                 | Architectural inspiration for modular monolith; already adopted in `packages/di`          |

### Module 08: task

| Source concept            | Absorption status         | Reason                                                                                    |
| ------------------------  | ------------------------- | ----------------------------------------------------------------------------------------- |
| Classification            | Absorbed (Spec 2)         | Task classification by type (review, verification, etc.)                                  |
| DAG execution             | Absorbed (Spec 2)         | Task dependency graph for parallel execution                                              |
| Lifecycle management      | Absorbed (Spec 2)         | Full state machine with optimistic locking                                                |
| Token budget              | Added (Orchestrator §7)   | Per-task token budget to prevent runaway LLM costs                                        |

### Module 09: multi-agent

| Source concept           | Absorption status          | Reason                                                                                    |
| -----------------------  | -------------------------- | ----------------------------------------------------------------------------------------- |
| MapReduce pattern        | Added note                 | Bounded loops for parallel context gathering                                              |
| Debate / Critique        | Added note                 | Multi-agent critique for high-stakes reviews (Phase 3, bounded)                           |
| Ensemble                 | Added note                 | Ensemble voting for edge cases (Phase 3, bounded)                                         |

### Module 10: automation

| Source concept            | Absorption status         | Reason                                                                                    |
| ------------------------  | ------------------------- | ----------------------------------------------------------------------------------------- |
| CI/CD integration         | Reference → future spec    | Belongs to Spec 10; not promoted yet                                                      |
| Self-healing              | Reference → future spec    | Out of scope for current phases                                                           |
| Guardrails                | Added (Agent §3)           | Prompt and output guardrails                                                              |
| Observability             | Absorbed (Spec 10)         | OpenTelemetry tracing, Prometheus metrics, health endpoints                               |

### Module 11: evaluate

| Source concept                  | Absorption status                              | Reason                                                                                    |
| ------------------------------  | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Rubric-based scoring            | Added (Evaluation §5.2)                        | Multi-dimensional rubric: accuracy, completeness, actionability, safety                    |
| LLM-as-judge                   | Added (Evaluation §5.1)                        | Judge agent using `LLMProvider` seam; rubric-scored, auditable                            |
| Inter-judge agreement           | Added (Evaluation §5.1)                        | Multiple judges, agreement threshold, disagreement escalation                             |
| Gold corpus                     | Added (Evaluation §5.1)                        | Gold-label test corpus for regression testing                                             |
| Bias audit                      | Added (Evaluation §5.1)                        | Bias detection in judge decisions                                                         |

---

## 3. 4 Specialized DeepSeek Harness Patterns

| Pattern                                                                | HAI mapping                                                                          | Verdict                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| **Agent = Model + Harness**                                            | Captures the spirit of "AI is the execution component; Harness is the control plane" (Architecture §4.2) | Absorbed (conceptually)              |
| **Micro-kernel / Everything is a Plugin (Cordis + Context DI)**        | Modular monolith + `packages/di` + interface-based integration                       | Reference (architecture)             |
| **4 Runtime Modes (Standard/Code/Minimal/Creator)**                    | Code Mode → Agent sandbox + verification sandbox; Minimal → benchmark harness         | Added (Agent §14, Verification §5.5) |
| **Session Event Stream / Trajectory (Replay/Fork/Resume/Search)**      | Agent Runtime §6.1 — append-only, replayable, forked_from                            | Absorbed                             |
| **Code Mode SDK (vm sandbox, batched tools)**                          | Sandbox isolation for Agent §14 + Verification §5.5                                  | Added                                |
| **Minimal Benchmark Harness (2 tools + container)**                    | Evaluation §5.1 — benchmark corpus runtime                                           | Added                                |

---

## 4. Not Fit — And Reasons

| Technique                                                        | Rejection reason (now)                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Vector-DB / ANN index / chunking (01)                            | Postgres-only Phase 1; only makes sense when Phase 3 enables semantic  |
| MultiTurnContextManager (02)                                     | HAI is trajectory-based, not a chat session                            |
| Multi-agent Debate/Ensemble (09) before Phase 3                  | Conflicts with Phase 1 non-goals; AI-check-AI cannot replace Humans    |
| Full DevOps CI/CD, automated self-healing (10) before Phase 2    | Belongs to Spec 10; not yet promoted                                   |

---

## 5. Changes Made in `docs/`

| File                                     | Changes                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/context-engine/README.md`      | + §5.2 Hierarchical context, lost-in-the-middle, cache, validator, RAG-Fusion |
| `packages/memory/README.md`              | + §4.5 Consolidation/decay/archive, relevance scoring, retrieval patterns     |
| `packages/agent-runtime/README.md`       | + §14 RBAC tiers, tool rate-limit, Code-Mode sandbox (expanded)               |
| `packages/verification-engine/README.md` | + §5.5 Code Mode / Benchmark container isolation reference                    |
| `packages/orchestrator/README.md`        | + §7 Saga/compensation + circuit breaker; Phase 3 Decomposer planning         |
| `packages/evaluation/README.md`          | + §5.2 Minimal Benchmark Harness runtime + rubric dimensions                  |

All additions were placed in the correct phase (no Phase 3 techniques dragged down to Phase 1), preserving the `Status / Dependency / Purpose` convention, and not breaking the dependency rule (engines don't import each other).
