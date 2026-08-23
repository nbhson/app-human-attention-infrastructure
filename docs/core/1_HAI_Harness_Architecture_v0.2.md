# Human Attention Infrastructure (HAI) Harness
## Architecture Overview

**Status:** Living, v0.6 — `review-reorient`: the code-generation path is retired; the product is now a PR/MR **review** control plane.
**Purpose:** The high-level architectural map of the Harness. Per-subsystem detail — data models, lifecycles, workflows, invariants, API surface — lives in each package's own `README.md`. This document is the **index**, not the spec.

---

# 1. What the Harness Is

> **AI produces work; the Harness — with AI as reviewer, not author — observes, verifies, evaluates, prioritizes, and routes that work to Human Attention.**

The Harness is the **control plane for Human Attention in AI-native software development**. It exists because:

> **AI can generate software changes faster than humans can inspect and validate them. Human attention is the bottleneck.**

Its single job is to reduce the amount of human attention required to *safely* accept a (human- or AI-authored) change. As of `review-reorient` the harness does this by **reviewing external pull/merge requests**: fetch the PR diff + the linked requirement, ask the configured AI provider to act as *reviewer* (report + findings + fix suggestions), and present the result to a human. The AI no longer writes or commits code.

---

# 2. The Core Loop

```text
Code Change (PR / MR — human- or AI-authored)
    ↓
Observation
    ↓
Understanding
    ↓
Verification
    ↓
Risk / Impact Analysis
    ↓
Attention Prioritization
    ↓
Human Decision
    ↓
Evidence / Memory
    ↓
Next Review
```

The architecture exists to make this loop explicit, measurable, and auditable.

---

# 3. Core Mental Model

```text
                    ┌─────────────┐
                    │    HUMAN    │
                    └──────┬──────┘
                           │
                     ATTENTION
                           │
                           ▼
                ┌───────────────────┐
                │      HARNESS      │
                │                   │
                │ Understand        │
                │ Verify            │
                │ Prioritize        │
                │ Explain           │
                │ Record            │
                └─────────┬─────────┘
                          │
                     EXECUTION
                          │
                          ▼
                ┌───────────────────┐
                │       AI          │
                │                   │
                │ Review            │
                │ Analyze           │
                │ Explain           │
                │ (read-only)       │
                └───────────────────┘
```

The Harness sits between human and AI: it turns raw AI output into *reviewable decisions*, and records everything along the way.

---

# 4. Conceptual Layers

```text
┌───────────────────────────────────────────────────────────┐
│                    HUMAN ATTENTION                        │
│        Review / Approve / Reject / Correct / Decide       │
└───────────────────────────┬───────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────┐
│                  HUMAN ATTENTION LAYER                    │
│   Review Queue · Attention Prioritization · Evidence      │
└───────────────────────────┬───────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────┐
│                    HAI CORE PLATFORM                      │
│  Orchestrator · Attention · Verification · Context        │
│  Agent Runtime · Artifact / Change Tracking               │
└───────────────────────────┬───────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────┐
│                 INTEGRATION / INFRASTRUCTURE              │
│  Git · CI/CD · AI Models · MCP/Tools · Issue Trackers · DB│
└───────────────────────────────────────────────────────────┘
```

Modular by design — but **not** microservices. It ships as a single monorepo (see [§8](#8-repository-layout)).

---

# 5. Architectural Principles

1. **Human attention is a first-class, measurable resource** — optimized alongside latency and throughput: review time, cognitive load, decision quality, attention allocation.
2. **AI is an execution component, not the authority** — AI proposes (reviews, analyses, explanations); the Harness determines whether the output is trusted, verified, risky, blocked, or escalated.
3. **Evidence before confidence** — `Claim ≠ Evidence`. Prefer "here is the evidence" (test results, diffs, symbols) over "the AI says it's correct".
4. **Everything important is observable** — every meaningful operation produces a trace (task, agent, model, tools, files, commands, verification, risk, decision, outcome), which becomes the foundation for audit, evaluation, and learning.
5. **Modular core, replaceable integrations** — no hard dependency on a specific LLM provider, Git host, CI, issue tracker, or vector DB; adapters implement internal interfaces.

---

# 6. Subsystem → Package Map

The eleven conceptual subsystems are now all built and documented in their packages (the former one-spec-per-subsystem files under `docs/core/` are retired).

| # | Subsystem | Built as | Docs |
|---|-----------|----------|------|
| 1 | Architecture | *this document* | `docs/core/1_…_v0.2.md` |
| 2 | Task / Work Orchestrator | `@harness/orchestrator` | [`packages/orchestrator/README.md`](../../packages/orchestrator/README.md) |
| 3 | AI Agent Runtime | `@harness/agent-runtime` | [`packages/agent-runtime/README.md`](../../packages/agent-runtime/README.md) |
| 4 | Context Engine | `@harness/context-engine` | [`packages/context-engine/README.md`](../../packages/context-engine/README.md) |
| 5 | Artifact / Change Tracker | `@harness/artifact-tracker` | [`packages/artifact-tracker/README.md`](../../packages/artifact-tracker/README.md) |
| 6 | Attention Engine | `@harness/attention-engine` | [`packages/attention-engine/README.md`](../../packages/attention-engine/README.md) |
| 7 | Verification Engine | `@harness/verification-engine` | [`packages/verification-engine/README.md`](../../packages/verification-engine/README.md) |
| 8 | Human Review Interface | `@harness/review` + `apps/web` | [`packages/review/README.md`](../../packages/review/README.md) |
| 9 | Memory / Evidence System | `@harness/domain` (events) + `db.event_log` | [`packages/db/README.md`](../../packages/db/README.md) |
| 10 | Observability / Governance | `@harness/observability` | [`packages/observability/README.md`](../../packages/observability/README.md) |
| 11 | Evaluation Engine (Learning Loop) | `@harness/evaluation` | [`packages/evaluation/README.md`](../../packages/evaluation/README.md) |

**Shared foundation** (not runtime subsystems — wired once in `apps/api/src/bootstrap.ts`):

| Package | Role |
|---|---|
| [`@harness/domain`](../../packages/domain/README.md) | Branded IDs, aggregates, event vocabulary, `TaskStatus`, `HumanDecisionType` |
| [`@harness/event-bus`](../../packages/event-bus/README.md) | `IEventBus` + in-process `EventEmitter` implementation |
| [`@harness/db`](../../packages/db/README.md) | Drizzle schema (41 tables), append-only `event_log`, data access |
| [`@harness/di`](../../packages/di/README.md) | Hand-rolled container + string `TOKENS` |

**Phase-2 seams** (promoted to packages, each with its own README): [`@harness/auth`](../../packages/auth/README.md) (OIDC identity + roles), [`@harness/embeddings`](../../packages/embeddings/README.md) (pgvector embedder, shadow mode), [`@harness/evaluation`](../../packages/evaluation/README.md), [`@harness/object-store`](../../packages/object-store/README.md) (S3/MinIO), [`@harness/observability`](../../packages/observability/README.md), [`@harness/sandbox`](../../packages/sandbox/README.md) (Docker-isolated execution).

**Review-slice seams** (`review-reorient`): [`@harness/git-provider`](../../packages/git-provider/README.md) (`GitProvider` — GitHub now, GitLab/Bitbucket Phase 3), [`@harness/ticket-provider`](../../packages/ticket-provider/README.md) (`TicketProvider` — Jira). Both depend only on `@harness/domain` and drive the review ingest path.

---

# 7. Cross-Cutting Invariants

These rules hold regardless of subsystem; each is documented where it is enforced.

- **Canonical Task state machine (13 states).** The single source of truth for Task transitions is `@harness/orchestrator`'s `TaskStateMachine`; the value list lives in `@harness/domain`'s `TaskStatus`. See [`packages/orchestrator/README.md`](../../packages/orchestrator/README.md). *(No other document redefines it.)*
- **Append-only `event_log` is the source of truth.** Every state change, LLM call, and decision lands there, joined by `correlation_id`; all other tables are current-state projections rebuildable by replay. See [`packages/db/README.md`](../../packages/db/README.md).
- **Engine boundary rule.** An engine imports only shared packages (`domain`, `event-bus`, `db`, `di`) — never another engine. Enforced by `eslint.config.mjs` + `architecture.test.ts`; the full object graph is in [`docs/architecture/wiring-map.md`](../architecture/wiring-map.md).
- **Human decisions are a closed set.** `HumanDecisionType` (7 values, the seventh `AUTO_APPROVED` — the one decision the system may make itself, under the gated auto-approve path with sampling audit). See [`packages/domain/README.md`](../../packages/domain/README.md).
- **Shadow-then-default.** A new signal (semantic retrieval, fitted attention weights) stays behind a measured A/B comparison and only becomes the default by winning — never by being newer. See [`packages/attention-engine/README.md`](../../packages/attention-engine/README.md) and [`packages/evaluation/README.md`](../../packages/evaluation/README.md).

---

# 8. Repository Layout

The modular monolith is realized (not a target):

```text
hai-harness/
├── apps/
│   ├── api/                 # Fastify API + single DI bootstrap (bootstrap.ts)
│   └── web/                 # React + Vite review UI
├── packages/                # 19 packages under @harness/* (see §6 table)
├── docs/
│   ├── core/                # this architecture overview
│   ├── plan/                # day-by-day build plans (Phases 1–3)
│   ├── architecture/        # wiring map + living architecture notes
│   ├── runbook/             # operators runbook (R1–R8), audit cookbook, limitations
│   ├── retros/              # honest weekly + phase retrospectives
│   └── dev-guide.md         # clone-to-green walkthrough
├── infra/                   # docker / deployment
├── scripts/                 # demo + eval scripts
└── README.md                # project entry point
```

Full per-package source trees are in each package's `README.md`; the clone-to-green path is [`docs/dev-guide.md`](../dev-guide.md).

---

# 9. Delivery Status

- **Phase 1 — Prove the Core Loop:** complete (`v0.1.0-harness`). Vertical slice: Task → Context → Agent → Artifact → Verification → Attention → Review → Decision → Evidence.
- **Phase 2 — Calibrate & Close the Measurement Loop:** complete (`v0.2.0-harness`). Evaluation engine, weight calibration, semantic-search infrastructure (shadow), auto-approve behind flag. Exit review: **8 of 9** criteria met; the one caveat (fitted weights 0.316 did not beat the placeholder 0.262) carries into Phase 3.
- **Phase 3 — Learn & Automate Under Guardrails:** not started.

Build order and backlog: [`docs/plan/README.md`](../plan/README.md) → [`docs/plan/phase-3/README.md`](../plan/phase-3/README.md).

---

## Changelog

### v0.6 (`review-reorient`)
- §1–§3 — reframed the Harness from "AI code author" to "PR/MR **review** control plane": the core-loop trigger is an external code change, and the AI box is `Review / Analyze / Explain (read-only)`.
- §6 — corrected the table count (41), added the review-slice seams (`git-provider`, `ticket-provider`), and dropped the stale `reconcile` note from the layout (§8).
- §7 — de-numbered the "35 tables" invariant so it can't drift again.

### v0.5 (Overview restructure)
- Collapsed the per-subsystem detail sections (former §7–§22: domain objects, agent execution, context, artifact, attention, verification, decision, evidence, memory, event model, physical architecture, dependency direction, end-to-end flow, "what not to build", success criteria) into §6–§7, since that material now lives in each package's `README.md` and the wiring map.
- Kept the high-level overview only: what the Harness is (§1), the core loop (§2), mental model (§3), layers (§4), principles (§5), subsystem→package index (§6), invariants (§7), and layout (§8).

### v0.4 (Phase 2 complete — Phase 3 not yet started)
- §13 — added `AUTO_APPROVED` to the human-decision examples and pointed the closed set at `HumanDecisionType` in `@harness/domain`.
- §19 — replaced the speculative package sketch with the realized 17-package layout.
- §24 — marked Phase 1 / Phase 2 complete and updated phase-exit-criteria status.

### v0.3 (Phase 2 complete — `v0.2.0-harness`)
- §5 — replaced the one-spec-per-subsystem model with the package-README model (subsystem→package mapping table).
- §7.2 — repointed the Task state-machine reference to `@harness/orchestrator` / `@harness/domain`.

### v0.2 (Day 29)
- Reconciled against the built Phase-1 system; documented the startup reconciler, Ops API, and Operators Runbook.