# Human Attention Infrastructure (HAI) Harness

## Architecture Overview

**Status:** Living, v0.6 — `review-reorient`: the code-generation path is retired; the product is now a PR/MR **review** control plane.
**Purpose:** The high-level architectural map of the Harness. Per-subsystem detail — data models, lifecycles, workflows, invariants, API surface — lives in each package's own `README.md`. This document is the **index**, not the spec.

---

# 1. What the Harness Is

> **AI produces work; the Harness — with AI as reviewer, not author — observes, verifies, evaluates, prioritizes, and routes that work to Human Attention.**

The Harness is the **control plane for Human Attention in AI-native software development**. It exists because:

> **AI can generate software changes faster than humans can inspect and validate them. Human attention is the bottleneck.**

Its single job is to reduce the amount of human attention required to _safely_ accept a (human- or AI-authored) change. As of `review-reorient` the harness does this by **reviewing external pull/merge requests**: fetch the PR diff + the linked requirement, ask the configured AI provider to act as _reviewer_ (report + findings + fix suggestions), and present the result to a human. The AI no longer writes or commits code.

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

The Harness sits between human and AI: it turns raw AI output into _reviewable decisions_, and records everything along the way.

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

The eleven conceptual subsystems are now all built and documented in their packages (the former one-spec-per-subsystem files are retired).

| #   | Subsystem                         | Built as                                    | Docs                                                                                     |
| --- | --------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Architecture                      | _this document_                             | _this document_                                                                          |
| 2   | Task / Work Orchestrator          | `@harness/orchestrator`                     | [`packages/orchestrator/README.md`](../../packages/orchestrator/README.md)               |
| 3   | AI Agent Runtime                  | `@harness/agent-runtime`                    | [`packages/agent-runtime/README.md`](../../packages/agent-runtime/README.md)             |
| 4   | Context Engine                    | `@harness/context-engine`                   | [`packages/context-engine/README.md`](../../packages/context-engine/README.md)           |
| 5   | Artifact / Change Tracker         | `@harness/artifact-tracker`                 | [`packages/artifact-tracker/README.md`](../../packages/artifact-tracker/README.md)       |
| 6   | Attention Engine                  | `@harness/attention-engine`                 | [`packages/attention-engine/README.md`](../../packages/attention-engine/README.md)       |
| 7   | Verification Engine               | `@harness/verification-engine`              | [`packages/verification-engine/README.md`](../../packages/verification-engine/README.md) |
| 8   | Human Review Interface            | `@harness/review` + `apps/web`              | [`packages/review/README.md`](../../packages/review/README.md)                           |
| 9   | Memory / Evidence System          | `@harness/domain` (events) + `db.event_log` | [`packages/db/README.md`](../../packages/db/README.md)                                   |
| 10  | Observability / Governance        | `@harness/observability`                    | [`packages/observability/README.md`](../../packages/observability/README.md)             |
| 11  | Evaluation Engine (Learning Loop) | `@harness/evaluation`                       | [`packages/evaluation/README.md`](../../packages/evaluation/README.md)                   |

The eleven subsystems above are all implemented as `@harness/*` engines. The
remaining packages complete the 25-package inventory, grouped by the same four
**dependency layers** used across the repo — the authoritative table is the
[Packages table](../../README.md#packages), mirrored in [`packages/README.md`](../../packages/README.md):

> **Why 11 subsystems but 25 packages?** Each subsystem maps to one _conceptual
> capability_ (e.g. Attention Engine, Verification Engine). The other 14 packages
> are infrastructure, integration, and tooling — not subsystems in their own right:
> `event-bus`, `di`, `db`, `observability` (foundation); `git-provider`,
> `ticket-provider`, `writeback`, `mcp` (integration seams); `object-store`,
> `sandbox`, `code-index`, `benchmark` (tooling/leaf). The layer inventory below
> covers all 25.

- **Foundation** — `domain`, `event-bus`, `di`, `db`, `observability` — shared, inward-only core.
- **Engines** — `orchestrator`, `agent-runtime`, `artifact-tracker`, `verification-engine`, `attention-engine`, `context-engine`, `review`, `auth`, `embeddings`, `evaluation` — read/write the foundation, never import a sibling engine.
- **Review slice** — `git-provider`, `ticket-provider`, `writeback`, `memory`, `judge`, `benchmark` — the review product path.
- **Tooling** — `object-store`, `sandbox`, `mcp`, `code-index` — leaf seams / CLI, import no `@harness` package.

---

# 7. Cross-Cutting Invariants

These rules hold regardless of subsystem; each is documented where it is enforced.

- **Canonical Task state machine (13 states).** The single source of truth for Task transitions is `@harness/orchestrator`'s `TaskStateMachine`; the value list lives in `@harness/domain`'s `TaskStatus`. See [`packages/orchestrator/README.md`](../../packages/orchestrator/README.md). _(No other document redefines it.)_
- **Append-only `event_log` is the source of truth.** Every state change, LLM call, and decision lands there, joined by `correlation_id`; all other tables are current-state projections rebuildable by replay. See [`packages/db/README.md`](../../packages/db/README.md).
- **Engine boundary rule.** An engine imports only shared packages (`domain`, `event-bus`, `db`, `di`) — never another engine. Enforced by `eslint.config.mjs` + `architecture.test.ts`; the full object graph is in [`docs/architecture/wiring-map.md`](../architecture/wiring-map.md).
- **Human decisions are a closed set.** `HumanDecisionType` (7 values, the seventh `AUTO_APPROVED` — the one decision the system may make itself, under the gated auto-approve path with sampling audit). See [`packages/domain/README.md`](../../packages/domain/README.md).
- **Shadow-then-default.** A new signal (semantic retrieval, fitted attention weights) stays behind a measured A/B comparison and only becomes the default by winning — never by being newer. See [`packages/attention-engine/README.md`](../../packages/attention-engine/README.md) and [`packages/evaluation/README.md`](../../packages/evaluation/README.md).
- **Async review pipeline with progressive findings.** `POST /api/reviews` returns `202 Accepted` immediately; the actual review runs in a background worker (`ReviewWorkerSubscriber`) subscribed to the `review.requested` event. The `review_reports` table tracks pipeline stage via `review_status` (`pending` → `fetching` → `recalling` → `reviewing` → `storing` → `complete` / `error`) and batch progress via `batch_progress` (`{ current, total }`). Findings are inserted per-batch as each AI call completes — the frontend polls and shows partial results before the full review finishes. An optional **text.md instructions flow** injects an operator-uploaded skills file into both the summarize and batch-review prompts; see [`docs/dev-guide.md`](../dev-guide.md#review-instructions-textmd). See [`apps/api/src/services/review-ingest.ts`](../../apps/api/src/services/review-ingest.ts) and [`docs/dev-guide.md`](../dev-guide.md#background-worker--progressive-findings).

---

# 8. Repository Layout

The modular monolith is realized (not a target):

```text
hai-harness/
├── apps/
│   ├── api/                 # Fastify API + single DI bootstrap (bootstrap.ts)
│   └── web/                 # React + Vite review UI
├── packages/                # 25 packages under @harness/* (see §6 table)
├── docs/
│   ├── architecture/        # architecture spec + wiring map + living notes
│   ├── runbook/             # operators runbook (R1–R10), audit cookbook, limitations
│   ├── retros/              # honest weekly + phase retrospectives
│   └── dev-guide.md         # clone-to-green walkthrough
├── docker-compose.yml       # Postgres :5432 (the only docker service)
├── scripts/                 # demo + eval scripts
└── README.md                # project entry point
```

Full per-package source trees are in each package's `README.md`; the clone-to-green path is [`docs/dev-guide.md`](../dev-guide.md).

---

# 9. Delivery Status

- **Core loop** (`v0.1.0-harness`): Task → Context → Agent → Artifact → Verification → Attention → Review → Decision → Evidence.
- **Measurement loop** (`v0.2.0-harness`): Evaluation engine, weight calibration, semantic-search infrastructure (shadow), auto-approve behind flag. Exit review: **8 of 9** criteria met; the one caveat (fitted weights 0.316 did not beat the placeholder 0.262) carried forward.
- **Review control plane** (`v0.4.0-harness`): MCP connectivity (GitHub/GitLab/Bitbucket/Jira via one `@harness/mcp` client + `mcp.config.json`), toggle-gated write-back, review memory, LLM-as-judge with inter-judge agreement, and the closed learning loop. Exit review: **8 of 9** criteria met → `EXIT-WITH-CARRYFORWARD`; the one caveat (hybrid ranking not the default — Day-29 A/B HOLD) is carried forward (CF-1 / CF-2) in the [`phase3-exit-review`](../retros/phase3-exit-review.md).
- **Async review + progressive findings** (`v0.4.0-harness`): Review pipeline is now fully async — `POST /api/reviews` returns `202 Accepted`, `ReviewWorkerSubscriber` processes the review in the background via `review.requested` event. Large PRs are split into parallel batches (`batchReview`); findings are inserted progressively per-batch, and the frontend polls `review_status` + `batch_progress` to show partial results in real time. The `review_reports` table tracks the full pipeline lifecycle (`pending` → `fetching` → `recalling` → `reviewing` → `storing` → `complete` / `error`).

The day-by-day build plan has been retired; the honest build history and exit reviews live in [`docs/retros/`](../retros/).
