# Human Attention Infrastructure (HAI) Harness
## Architecture Specification — Starting From Zero

**Status:** Draft v0.2  
**Purpose:** Define the architectural foundation for an AI-native software development harness focused on optimizing Human Attention.

---

# 1. Architecture

## 1.1 Purpose

Architecture is the first thing to build.

The Harness should not begin as a collection of features such as RAG, agents, MCP, code search, review UI, or dashboards.

It should begin with a clear system architecture that defines:

- what the Harness owns
- what external systems it integrates with
- how work flows through the system
- where evidence is generated
- where human decisions happen
- how state and memory are persisted
- how components communicate
- how future capabilities can be added without redesigning the core

The central architectural principle is:

> **AI produces work; the Harness observes, verifies, evaluates, prioritizes, and routes that work to Human Attention.**

---

# 2. Architectural Goal

The Harness exists to solve one fundamental problem:

> **AI can generate software changes faster than humans can inspect and validate them. Human Attention becomes the bottleneck.**

Therefore the architecture must optimize for:

```text
AI Output
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
Next AI Action
```

The architecture should make this loop explicit.

---

# 3. Core Architectural Model

The system can initially be organized into four major layers.

```text
┌───────────────────────────────────────────────────────────┐
│                    HUMAN ATTENTION                        │
│                                                           │
│ Review / Approve / Reject / Correct / Decide / Override  │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                  HUMAN ATTENTION LAYER                     │
│                                                           │
│ Review Queue                                              │
│ Attention Prioritization                                  │
│ Risk Visualization                                        │
│ Evidence Presentation                                     │
│ Human Decision Capture                                    │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                    HAI CORE PLATFORM                       │
│                                                           │
│ Work Orchestrator                                         │
│ Attention Engine                                          │
│ Verification Engine                                       │
│ Context Engine                                            │
│ Agent Runtime                                             │
│ Artifact / Change Tracking                                │
└───────────────────────────┬───────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                 INTEGRATION / INFRASTRUCTURE              │
│                                                           │
│ Git / Repository                                          │
│ CI/CD                                                     │
│ AI Models                                                 │
│ MCP / Tools                                               │
│ Issue Trackers                                            │
│ Databases                                                 │
│ File Systems                                              │
└───────────────────────────────────────────────────────────┘
```

This is the initial conceptual architecture.

It is intentionally modular, but does **not** require microservices.

---

# 4. Architectural Principles

## 4.1 Human Attention is a first-class resource

Traditional software systems optimize:

- CPU
- memory
- latency
- throughput

HAI additionally optimizes:

- human review time
- cognitive load
- decision quality
- attention allocation

Therefore the architecture must treat Human Attention as a measurable resource.

---

## 4.2 AI is an execution component, not the authority

The AI Agent should not be the final authority.

```text
AI
 ↓
Proposal
 ↓
Evidence
 ↓
Human / Policy Decision
```

AI can propose:

- code
- architecture
- tests
- refactors
- explanations
- plans

But the Harness determines whether the output is:

- trusted
- verified
- risky
- reviewable
- blocked
- escalated

---

## 4.3 Evidence before confidence

The system should prefer:

```text
"Here is the evidence"
```

over:

```text
"The AI says it is correct."
```

Evidence may include:

- test results
- compiler results
- static analysis
- security scans
- dependency analysis
- runtime observations
- code diffs
- affected symbols
- architecture violations
- previous decisions

---

## 4.4 Everything important should be observable

Every meaningful AI operation should produce a trace.

At minimum:

```text
Task
Agent
Model
Prompt / Context Reference
Tools Used
Files Read
Files Changed
Commands Executed
Verification Results
Risk Assessment
Human Decision
Final Outcome
```

This trace becomes the foundation for:

- debugging
- auditing
- evaluation
- learning
- memory
- analytics

---

## 4.5 Modular core, replaceable integrations

The architecture should not depend directly on a specific:

- LLM provider
- IDE
- Git provider
- CI provider
- issue tracker
- vector database
- code indexing technology

Use internal interfaces.

For example:

```text
LLMProvider
 ├── OpenAI
 ├── Anthropic
 ├── Gemini
 ├── Ollama
 └── Other

RepositoryProvider
 ├── GitHub
 ├── GitLab
 └── Local Git

VerificationProvider
 ├── Jest
 ├── Vitest
 ├── PyTest
 ├── Maven
 └── Custom
```

---

# 5. The Eleven Core Subsystems

The initial architecture consists of eleven major subsystems.

```text
1. Architecture
2. Work / Task Orchestrator
3. AI Agent Runtime
4. Context Engine
5. Artifact / Change Tracker
6. Attention Engine
7. Verification Engine
8. Human Review Interface
9. Memory / Evidence System
10. Observability / Governance
11. Evaluation Engine (Learning Loop)
```

Architecture is not a runtime subsystem itself.

It is the foundation that defines how the other ten subsystems interact.

The **Evaluation Engine** closes the loop. Verification (7) answers "is this change correct?"; Evaluation (11) answers "is our pipeline — model, prompt, context, ranking, weights — actually good?", and feeds calibration back into Attention (6) and Context (4). Without it, the critical milestone's final step, *Learning*, has no owner.

**Specification status (v0.2):** Subsystems 1–7, 9, and 11 have dedicated specifications in `docs/core/`. All seven Phase-1 specs (1–7) are at `v0.2` as of Day 29, reconciled against the built system. Subsystem 8 (Human Review Interface) and 10 (Observability / Governance) are implemented inside `docs/plan/phase-1/day-22..27` and are promoted to standalone specs in Phase 2.

**As-built Phase 1 additions not in the original eleven:** three cross-cutting runtime pieces shipped in Days 27–28 and are documented here because they cut across almost every subsystem:

- **Startup reconciler** (`apps/api/src/reconcile.ts`, Day 28) — a one-shot boot step that escorts tasks stranded in `EXECUTING`/`VERIFYING` by a non-graceful crash to `AWAITING_HUMAN_INTERVENTION` (reason `PROCESS_DIED`), publishing `task.orphan_recovered`. It is the *only* sanctioned auto-repair in the system (see the Operators Runbook, `docs/runbook/README.md`).
- **Ops API** (`GET /api/ops/health`, `GET /api/ops/metrics`, Day 27) — the database is the dashboard; these endpoints expose task-state tallies, review-queue depth, and the orphan-alarm count.
- **Operations Runbook** (`docs/runbook/`, Day 29) — incident-oriented procedures R1–R8, the audit-query cookbook, and the known-limitations list.

---

# 6. System Context

At the highest level:

```text
                         Developer
                             │
                             ▼
                    ┌─────────────────┐
                    │      HAI        │
                    │     Harness     │
                    └─────────────────┘
                      │    │    │    │
          ┌───────────┘    │    │    └────────────┐
          ▼                ▼    ▼                 ▼
       AI Models          Git  CI/CD          Issue Tracker
          │
          ▼
        Tools
       / MCP
```

The Harness is the control plane between:

```text
Human
  ↕
Harness
  ↕
AI + Software Development Environment
```

---

# 7. Core Domain Objects

Before implementing components, define the core domain model.

These objects are more important than the UI.

## 7.1 Project

Represents a software project.

```text
Project
├── Repository
├── Architecture
├── Configuration
├── Policies
├── Context
├── Memory
└── History
```

---

## 7.2 Task

Represents a unit of work.

```text
Task
├── id
├── description
├── requirements
├── context
├── status
├── owner
├── agents
├── artifacts
├── evidence
├── decisions
└── outcome
```

The canonical Task state machine is defined in the Task / Work Orchestrator specification (`2_Task_Work_Orchestrator_v0.2.md`, Section 3), which is the **single source of truth** for Task states and transitions. This document does not redefine them.

High-level flow (simplified):

```text
PENDING → QUEUED → EXECUTING → VERIFYING → AWAITING_REVIEW → APPROVED → COMPLETED
                                  ↓              ↓
                               FAILED         REJECTED → REWORK
```

---

# 8. Agent Execution Model

The Agent Runtime executes AI work.

```text
Task
 ↓
Agent
 ↓
Plan
 ↓
Tool Calls
 ↓
Artifacts
 ↓
Verification
 ↓
Result
```

The Harness should not treat an agent execution as a black box.

Instead:

```text
Agent Run
│
├── Input
├── Context
├── Plan
├── Step 1
│   ├── Tool
│   ├── Input
│   └── Output
├── Step 2
│   ├── Tool
│   ├── Input
│   └── Output
├── ...
├── Changes
├── Verification
└── Final Result
```

This execution history is the **Trajectory**.

---

# 9. Context Architecture

The Context Engine is responsible for deciding what information the AI receives.

```text
Task
 │
 ▼
Context Resolver
 │
 ├── Relevant Files
 ├── Symbols
 ├── Architecture
 ├── Documentation
 ├── Git History
 ├── Tests
 ├── Previous Decisions
 └── Runtime Evidence
 │
 ▼
Context Ranking
 │
 ▼
Context Compression
 │
 ▼
Agent
```

The key principle:

> Context should be selected by relevance, not simply dumped into the model.

---

# 10. Artifact and Change Architecture

Every generated artifact should be tracked.

```text
Artifact
├── File
├── Code
├── Test
├── Documentation
├── Configuration
├── Architecture Decision
└── Other Output
```

Every change should have provenance:

```text
Change
├── Task
├── Agent
├── Model
├── Timestamp
├── Source Context
├── Files Affected
├── Reason
├── Verification
└── Human Decision
```

This enables the Harness to answer:

> Who changed what, why, using which model, based on which context, and with what evidence?

---

# 11. Attention Architecture

This is the most important subsystem.

The Attention Engine receives:

```text
Task
+
AI Output
+
Changes
+
Verification
+
Context
+
Project Rules
```

and produces:

```text
Attention Assessment
```

Conceptually:

```text
Attention Assessment
├── Risk Score
├── Impact Score
├── Confidence
├── Novelty
├── Complexity
├── Review Priority
├── Required Reviewer
└── Review Reason
```

Example:

```text
Change: PaymentService.ts

Risk: HIGH
Impact: HIGH
Confidence: LOW
Novelty: HIGH

Reasons:
- Business logic changed
- External API behavior changed
- No regression test
- Security-sensitive path

Decision:
→ HUMAN REVIEW REQUIRED
```

---

# 12. Verification Architecture

Verification should be independent from the AI.

```text
                    AI Output
                       │
                       ▼
               Verification Engine
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
     Compile          Tests          Static
                                      Analysis
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                    Evidence
```

The Verification Engine should support multiple verification strategies through adapters.

---

# 13. Human Decision Architecture

Human decisions are domain events.

Examples:

```text
APPROVED
REJECTED
REQUEST_CHANGES
OVERRIDDEN
DEFERRED
ESCALATED
```

A decision should capture:

```text
Decision
├── Human
├── Timestamp
├── Target
├── Decision Type
├── Reason
├── Evidence Viewed
└── Result
```

This is essential because Human Review is not just UI interaction.

It is **valuable system knowledge**.

---

# 14. Evidence Architecture

Evidence is separate from AI output.

```text
AI says:
"Tests pass."
```

Harness should represent:

```text
Evidence
├── Test Run
│   ├── command
│   ├── result
│   ├── duration
│   └── logs
│
├── Static Analysis
├── Security Scan
├── Build
├── Runtime Check
└── Human Review
```

Therefore:

```text
Claim ≠ Evidence
```

The Harness should connect claims to evidence.

---

# 15. Memory Architecture

> **Boundary with Evidence (Section 14):** Evidence is the immutable record of *what happened* (test runs, tool outputs, decisions) — written once, never modified. Memory is the *curated, retrievable knowledge* derived from evidence (patterns, reusable decisions, project conventions) — it can be summarized, updated, and expired. Evidence answers "what exactly occurred?"; Memory answers "what should we recall for future work?"

Memory should not initially be treated as "just a vector database."

Conceptually:

```text
Memory
│
├── Task Memory
├── Session Memory
├── Project Memory
├── Architecture Memory
├── Decision Memory
├── Failure Memory
└── Review Memory
```

The storage implementation can evolve later.

The important first step is defining:

- what should be remembered
- why it should be remembered
- when it should be retrieved
- who can modify it
- how it expires

---

# 16. Event-Driven Internal Model

The architecture should be compatible with an event-driven model.

Example events:

```text
TaskCreated
AgentStarted
AgentStepStarted
ToolCalled
ToolCompleted
ArtifactCreated
ArtifactChanged
VerificationStarted
VerificationCompleted
RiskCalculated
ReviewRequested
HumanApproved
HumanRejected
TaskCompleted
```

Conceptually:

```text
                 Event Bus
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
 Attention      Evidence     Memory
 Engine         Store        System
```

This gives the system an auditable timeline.

---

# 17. Recommended Initial Physical Architecture

Do NOT start with microservices.

Start with a **Modular Monolith**.

```text
HAI Harness
│
├── API
│
├── Application Layer
│   ├── Task Module
│   ├── Agent Module
│   ├── Context Module
│   ├── Attention Module
│   ├── Verification Module
│   ├── Review Module
│   ├── Evidence Module
│   ├── Memory Module
│   └── Governance Module
│
├── Domain Layer
│   ├── Entities
│   ├── Value Objects
│   ├── Domain Events
│   └── Policies
│
├── Infrastructure Layer
│   ├── Database
│   ├── Git
│   ├── LLM Providers
│   ├── Tool / MCP Adapters
│   ├── CI/CD
│   └── File System
│
└── UI
```

Why Modular Monolith?

Because at this stage the biggest unknown is not scalability.

The biggest unknown is:

> **What is the correct domain model and interaction model?**

Keep deployment simple while allowing boundaries to remain explicit.

---

# 18. Dependency Direction

Dependencies should point inward.

```text
UI
 │
 ▼
Application
 │
 ▼
Domain
 ▲
 │
Infrastructure
```

Domain should NOT depend directly on:

- OpenAI
- Anthropic
- GitHub
- GitLab
- PostgreSQL
- Redis
- MCP
- a specific UI framework

Adapters implement interfaces defined by the core.

---

# 19. Initial Repository Structure

A reasonable starting structure:

```text
hai-harness/
│
├── apps/
│   ├── api/
│   └── web/
│
├── packages/
│   ├── domain/
│   ├── application/
│   ├── agent-runtime/
│   ├── context-engine/
│   ├── attention-engine/
│   ├── verification-engine/
│   ├── evidence/
│   ├── memory/
│   └── integrations/
│
├── infrastructure/
│   ├── database/
│   ├── docker/
│   └── deployment/
│
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── runbook/      # operators runbook (R1–R8), audit-query cookbook, limitations
│   └── specifications/
│
├── tests/
│
└── README.md
```

The exact technology can be decided later.

The important thing is preserving architectural boundaries.

---

# 20. Minimal End-to-End Flow

The first usable vertical slice should be extremely small.

```text
Developer
   │
   ▼
Create Task
   │
   ▼
AI Agent
   │
   ▼
Make Code Change
   │
   ▼
Track Change
   │
   ▼
Run Verification
   │
   ▼
Calculate Risk
   │
   ▼
Create Review Item
   │
   ▼
Human Review
   │
   ├── Approve
   └── Reject
   │
   ▼
Store Evidence + Decision
```

Do not build the entire platform before validating this loop.

---

# 21. What NOT to Build First

Avoid starting with:

- complex multi-agent orchestration
- advanced RAG
- vector database optimization
- sophisticated UI
- dozens of integrations
- autonomous coding loops
- distributed microservices
- Kubernetes
- complex memory systems
- advanced analytics

Those are implementation details that can come later.

First prove:

> **Can the Harness reduce the amount of Human Attention required to safely accept AI-generated software changes?**

---

# 22. Architecture Success Criteria

The architecture is successful if it allows us to implement the following without redesigning the core:

```text
✓ Multiple AI models
✓ Multiple AI agents
✓ Multiple repositories
✓ Multiple verification tools
✓ Multiple CI systems
✓ Human review
✓ Risk scoring
✓ Evidence collection
✓ Context retrieval
✓ Memory
✓ Audit trail
✓ Future IDE integrations
✓ Future autonomous workflows
```

Most importantly:

> Adding a new AI model should not require rewriting the Attention Engine.

> Adding a new verification tool should not require rewriting the Agent Runtime.

> Adding a new IDE should not require rewriting the Domain Layer.

---

# 23. The Core Mental Model

The entire architecture can be reduced to:

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
                │ Plan              │
                │ Code              │
                │ Analyze           │
                │ Use Tools         │
                └───────────────────┘
```

The Harness is the **control plane for Human Attention in AI-native software development**.

---

# 24. Architecture Roadmap (Three-Phase Delivery)

The long-term build order is defined by a **three-phase delivery model**. Each phase
ends with a demonstrable, tested slice — never with "all components half finished".

## 24.1 Phase Overview

```text
PHASE 1 — Prove the Core Loop (30 days, current plan)
    Vertical slice with evidence before confidence.
    Task → Context → Agent → Artifact → Verification
         → Attention → Human Review → Decision → Evidence

PHASE 2 — Calibrate & Close the Measurement Loop
    Evidence is collected; now measure the pipeline itself.
    Evaluation Engine v0 (offline metrics + A/B harness)
    Attention weight calibration from real usefulness data
    Semantic search infrastructure (pgvector + Embedder) — shadow/experimental, behind the Ranker seam
    Auto-approve for AUTO_APPROVABLE behind flag + sampling audit
    Promote Human Review Interface (8) & Observability (10) to standalone specs

PHASE 3 — Learn & Automate Under Guardrails
    The Learning milestone from the core loop becomes a real subsystem.
    Full Memory / Evidence System (retrieval, expiration, decision memory)
    Targeted / incremental verification (dependency graph)
    Context ranking → hybrid default (BM25 + embeddings + RRF + re-rank) + RAG Fusion
    Multi-agent orchestration + bounded autonomous loops
    Continuous improvement loop closes: Evaluate → Calibrate → Deploy → Observe
```

## 24.2 Subsystem Build Order (within the three phases)

```text
PHASE 1
Architecture
    ↓
Domain Model → Event Model → Module Boundaries
    ↓
Task / Work Orchestrator → Agent Runtime → Artifact Tracking
    ↓
Verification Engine → Evidence System (append-only store)
    ↓
Attention Engine (risk / impact / priority)
    ↓
Human Review Interface (minimal: APPROVE / REJECT / REWORK)
    ↓
Context Engine (code index → keyword rank → budget → selection)

PHASE 2
Evaluation Engine v0 (metrics, report, A/B harness)
    ↓
Attention calibration (weights fitted from review usefulness data)
    ↓
Semantic search infra (pgvector + Embedder) — shadow, not default
    ↓
Observability / Governance (metrics, audit, policy)

PHASE 3
Memory / Evidence (decision memory, project memory, learning from reviews)
    ↓
Targeted / incremental verification (dependency graph)
    ↓
Context ranking → hybrid default (BM25 + embeddings + RRF + re-rank) + RAG Fusion
    ↓
Multi-agent orchestration + bounded autonomous workflows
    ↓
Continuous improvement loop (full: Evaluate → Calibrate → Deploy → Observe)
```

## 24.3 The Critical Milestone

The critical milestone is not "all components are finished."

It is:

```text
AI Change
   ↓
Evidence
   ↓
Risk
   ↓
Human Attention
   ↓
Decision
   ↓
Learning
```

Once this loop works reliably, the Harness has a real core.

**Phase exit criteria:**

- **Phase 1 → 2:** The loop `AI Change → Evidence → Risk → Human Attention → Decision`
  is demonstrable end-to-end and evidence is queryable. *Learning* is still manual
  (a human reads the retrospective) — the Evaluation Engine does not exist yet.
- **Phase 2 → 3:** The pipeline is measured: metrics exist for precision/recall of
  what routes to a human, attention weights are fitted from real data, and the
  evaluation harness can compare two pipeline variants head-to-head.
- **Phase 3:** The *Learning* step closes the loop automatically — evaluation
  results and review decisions feed back into calibration and context ranking.

---

## Changelog

### v0.2 (Day 29)
- Reconciled against the built Phase-1 system (Days 1–28). The seven Phase-1
  specs (1–7) are now all `v0.2`.
- §5 — documented the three as-built runtime additions not in the original eleven:
  the startup reconciler (`task.orphan_recovered`, `PROCESS_DIED`), the Ops API
  (`/api/ops/health`, `/api/ops/metrics`), and the Operators Runbook.
- §19 — added `docs/runbook/` to the repository layout.
- Clarified the realized Phase-1 repository layout (packages `@harness/*`) lives in
  `docs/dev-guide.md`; the sketch in §19 remains the conceptual target, not the
  literal tree.
