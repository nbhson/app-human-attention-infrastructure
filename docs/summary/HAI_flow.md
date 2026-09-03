# HAI Harness — Operational Flow Overview

> **📍 Guide:** This is a flow summary of `docs/summary/HAI_overview.md`.
> For the full overview (4-layer architecture, 11 subsystems, domain objects, tech stack, roadmap),
> read **`HAI_overview.md`**.
>
> **`review-reorient` (v0.6):** The code-gen path is retired — the flow below reflects the **external PR/MR review** direction: AI is a _reviewer_ (read-only), no more "AI auto-generates fixes."

> **Human Attention Infrastructure (HAI) Harness** — an AI-native platform that manages and optimizes _"human attention"_ in software development:
> a code change (PR/MR) enters → Harness observes, verifies, assesses, uses AI to review, prioritizes, and routes to the right human attention.

Source: `docs/summary/HAI_overview.md`, `docs/architecture/HAI_Harness_Architecture_v0.6.md`, `packages/orchestrator/README.md`, `packages/attention-engine/README.md`.

---

## 1. System Context — HAI Between Humans and AI

```mermaid
flowchart TB
    H(["👤 Developer / Human Reviewer"]) <-->|"decide · review"| HAI["⚙️ HAI HARNESS<br/>(control plane for Human Attention)"]
    HAI <-->|"review (read-only)"| AI["🤖 AI Reviewer"]
    HAI <-->|"fetch PR / MR"| GIT["Git Provider"]
    HAI <-->|"fetch ticket & context"| IT["Issue Tracker"]
```

Harness is the **control plane** sitting between: `Human ↕ Harness ↕ AI + Development Environment`.

---

## 2. Core Loop — "Code change in, Harness reviews & controls"

Core problem: **code changes (PR/MR) are produced faster than humans can review them → Human Attention becomes the bottleneck.**

```mermaid
flowchart TB
    AIOUT["Code Change<br/>(PR / MR — human- or AI-authored)"]
    OBS["🔍 Observation<br/>(fetch diff + metadata)"]
    UND["📖 Understanding<br/>(Context Engine)"]
    VER["✅ Verification<br/>(compile → test → lint)"]
    RISK["⚠️ Risk / Impact Analysis<br/>(Attention Engine)"]
    P ("Prioritization<br/>(rank review order)")
    DEC["👤 Human Decision<br/>(APPROVE / REJECT / REWORK)"]
    EVID["🗂️ Evidence / Memory<br/>(append-only, traceable)"]
    NEXT["🔁 Next Review"]

    AIOUT --> OBS --> UND --> VER --> RISK --> P --> DEC --> EVID --> NEXT --> AIOUT
```

Key milestone (Spec 1 §24): `AI Change → Evidence → Risk → Human Attention → Decision → Learning`.

---

## 3. End-to-End Flow — 7 Processing Steps (Input → Output)

Input is **one code change to review** (diff/PR) + context (`jira_ticket`). Main flow:

```mermaid
flowchart TB
    IN(["📥 INPUT: change (PR/diff) + jira_ticket + target_repo + priority"])

    IN --> S1
    subgraph B1["1 · Receive & normalize change"]
        S1["Orchestrator + Artifact Tracker<br/>fetch diff → parse file → create review Task<br/>(PENDING → QUEUED)"]
    end

    S1 --> S2
    subgraph B2["2 · Build context"]
        S2["Context Engine<br/>touched files + dependencies + ticket content"]
    end

    S2 --> S3
    subgraph B3["3 · Verify (AI-independent)"]
        S3["Verification Engine<br/>compile → test → lint"]
    end

    S3 --> D3{"Evidence<br/>PASSED?"}

    D3 -- "FAILED" --> REWORK["🔁 REWORK / retry<br/>author fixes → resubmit"]
    REWORK -. "back to step 1" .-> IN

    D3 -- "PASSED" --> S4
    subgraph B4["4 · Score"]
        S4["Attention Engine<br/>Risk + Impact + Novelty + Complexity + Confidence<br/>→ priority (CRITICAL/HIGH/MEDIUM/LOW)"]
    end

    S4 --> S5
    subgraph B5["5 · Route"]
        S5["Place in review queue<br/>assign reviewer by priority"]
    end

    S5 --> S6
    subgraph B6["6 · Human decides"]
        S6["Human Review<br/>APPROVE / REJECT / REQUEST_CHANGES + rationale"]
    end

    S6 --> D6{"Decision?"}
    D6 -- "APPROVE" --> S7
    D6 -- "REJECT / REQUEST_CHANGES" --> REWORK

    subgraph B7["7 · Store evidence"]
        S7["Memory / Evidence System<br/>evidence chain + decision log (append-only)"]
    end

    S7 --> OUT(["✅ OUTPUT: Review decision + traceable evidence chain"])

    IN -. "ESCALATE (any state)" .-> ESC["🛑 AWAITING_HUMAN_INTERVENTION"]
    ESC --> REWORK

    subgraph ESCB["⚡ Escalation (any state → any state)"]
        ESC
    end
```

Exit condition: human decision (APPROVE/REJECT) + complete evidence chain.
Fallback: escalation to `AWAITING_HUMAN_INTERVENTION` at any stage.

---

## 4. Task State Machine

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> QUEUED
    QUEUED --> IN_PROGRESS
    IN_PROGRESS --> AWAITING_REVIEW
    AWAITING_REVIEW --> APPROVED
    AWAITING_REVIEW --> REJECTED
    REJECTED --> REWORK
    REWORK --> QUEUED
    AWAITING_REVIEW --> CANCELLED
    IN_PROGRESS --> FAILED
    FAILED --> REWORK
    FAILED --> AWAITING_HUMAN_INTERVENTION
    AWAITING_HUMAN_INTERVENTION --> AWAITING_REVIEW
    APPROVED --> COMPLETED
    REJECTED --> COMPLETED
    COMPLETED --> [*]
    CANCELLED --> [*]

    note right of AWAITING_HUMAN_INTERVENTION
        Escalation: any state
        can transition here.
    end note
    note right of CANCELLED
        Any state can be cancelled.
    end note
```

**Invariant (Spec 2):**

- State transitions use **optimistic locking** (`UPDATE ... WHERE id AND state = expected` → `StateConflictError`).
- `attempt_number` increments only on `REWORK → QUEUED`; idempotency key = `task_id:attempt_number`.
- All transitions are logged to `task_state_history` (audit).

Terminal states: `COMPLETED`, `CANCELLED`.

---

## 5. Attention Engine — Review Decision Logic

```mermaid
flowchart TB
    IN2(["Change arrives for review"]) --> CALC["Compute AttentionAssessment<br/>Risk · Impact · Novelty · Complexity · Confidence"]

    CALC --> FORMULA["combined_priority =<br/>0.35·risk + 0.25·impact + 0.15·novelty<br/>+ 0.10·complexity + 0.15·(1 − confidence)"]

    FORMULA --> D{"combined_priority<br/>≥ threshold?"}
    D -- "YES" --> REQ["🔴 REVIEW REQUIRED"]
    D -- "NO" --> POL{"Policy rules?"}
    POL -- "ALWAYS_REVIEW" --> REQ
    POL -- "NEVER_REVIEW / auto-approve" --> AUTO["🟢 AUTO-APPROVE<br/>(skip human)"]

    REQ --> QUEUE["Enter review queue<br/>(budget + adaptive thresholds)"]
    QUEUE --> FEED["Feedback: was_useful<br/>→ recalibrate weights"]
```

Labels: **CRITICAL ≥ 0.80 · HIGH ≥ 0.60 · MEDIUM ≥ 0.30 · LOW < 0.30**. Missing factor → redistribute weights + log `factors_unavailable`; all missing → default to HIGH (_fail toward attention_).

---

## 6. Event-Driven Timeline — Auditable

```mermaid
sequenceDiagram
    autonumber
    participant Auth as Author (Dev / AI Agent)
    participant Orc as Orchestrator
    participant Ctx as Context Engine
    participant Ver as Verification Engine
    participant Att as Attention Engine
    participant Hum as Human Reviewer
    participant Evi as Memory / Evidence

    Auth->>Orc: submit change (PR / diff) + ticket
    Orc->>Orc: create Task → task.created
    Orc->>Orc: transition CANCELLED (task.state_changed — review-only)
    Orc->>Ctx: build context (context snapshot)
    Orc->>Ver: trigger verification → verification.completed
    Ver-->>Orc: PASSED / FAILED (evidence)
    Orc->>Att: assessChange (if PASSED)
    Att-->>Orc: attention.assessment_created + item_routed
    Orc->>Hum: AWAITING_REVIEW → review queue
    Hum-->>Orc: review.decision_submitted (APPROVE / REJECT)
    Orc->>Evi: store evidence + decision log + review report
```

Every event is persisted **append-only** to `event_log` (idempotent), joinable by `correlation_id`.

Standard envelope: `{ event_id (UUIDv7), event_type, event_version, occurred_at, correlation_id, payload }` — naming `<domain>.<entity>_<verb_past_tense>`.

---

## 7. 4-Layer Architecture

```mermaid
flowchart TB
    subgraph L1["👤 HUMAN ATTENTION"]
        A1["Review / Approve / Reject / Correct / Override"]
    end
    subgraph L2["HUMAN ATTENTION LAYER"]
        B1["Review Queue · Priority · Routing<br/>Risk Visualization · Evidence Presentation"]
    end
    subgraph L3["HAI CORE PLATFORM"]
        C1["Work Orchestrator · Attention Engine · Verification Engine<br/>Context Engine · Agent Runtime · Artifact/Change Tracker"]
    end
    subgraph L4["INTEGRATION / INFRASTRUCTURE"]
        D1["Git · CI/CD · LLM Providers · MCP/Tools · Issue Tracker · DB"]
    end

    A1 --> B1 --> C1 --> D1
```

---

## 8. Roadmap (Completed)

The full build roadmap (Core Loop → Calibrate & Measure → Learn & Automate) is complete, tagged `v0.4.0-harness` (`EXIT-WITH-CARRYFORWARD`, 8/9 exit criteria). Day-by-day branching history (`docs/plan/`) has been removed; exit summary at `docs/retros/phase3-exit-review.md`.
