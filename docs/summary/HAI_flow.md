# HAI Harness — Tổng quan Flow Hoạt động

> **`review-reorient` (v0.6):** đường code-gen đã nghỉ hưu — flow dưới đây phản ánh hướng **review PR/MR bên ngoài**: AI là *reviewer* (đọc, không ghi), không còn "AI tự sinh fix".

> **Human Attention Infrastructure (HAI) Harness** — nền tảng AI-native quản lý và tối ưu hóa *"sự chú ý của con người"* trong phát triển phần mềm:
> một code change (PR/MR) đi vào → Harness quan sát, xác minh, đánh giá, dùng AI review, xếp ưu tiên và định tuyến tới đúng sự chú ý của con người.

Nguồn: `docs/summary/HAI_overview.md`, `docs/architecture/HAI_Harness_Architecture_v0.6.md`, `packages/orchestrator/README.md`, `packages/attention-engine/README.md`.

---

## 1. System Context — HAI ở giữa Con người và AI

```mermaid
flowchart TB
    H(["👤 Developer / Human Reviewer"]) <-->|"quyết định · review"| HAI["⚙️ HAI HARNESS<br/>(control plane cho Human Attention)"]
    HAI <-->|"review (read-only)"| AI["🤖 AI Reviewer"]
    HAI <-->|"fetch PR / MR"| GIT["Git Provider"]
    HAI <-->|"fetch ticket & context"| IT["Issue Tracker"]
```

Harness là **mặt phẳng điều khiển** nằm giữa: `Con người ↕ Harness ↕ AI + Môi trường phát triển`.

---

## 2. Core Loop — "Code change vào, Harness review & kiểm soát"

Vấn đề cốt lõi: **code change (PR/MR) sinh ra nhanh hơn con người có thể kiểm tra → Human Attention trở thành nút cổ chai.**

```mermaid
flowchart TB
    AIOUT["Code Change<br/>(PR / MR — human- or AI-authored)"]
    OBS["🔍 Observation<br/>(fetch diff + metadata)"]
    UND["📖 Understanding<br/>(Context Engine)"]
    VER["✅ Verification<br/>(compile → test → lint)"]
    RISK["⚠️ Risk / Impact Analysis<br/>(Attention Engine)"]
    P ("Prioritization<br/>(xếp thứ tự review)")
    DEC["👤 Human Decision<br/>(APPROVE / REJECT / REWORK)"]
    EVID["🗂️ Evidence / Memory<br/>(append-only, truy vết)"]
    NEXT["🔁 Next Review"]

    AIOUT --> OBS --> UND --> VER --> RISK --> P --> DEC --> EVID --> NEXT --> AIOUT
```

Milestone then chốt (Spec 1 §24): `AI Change → Evidence → Risk → Human Attention → Decision → Learning`.

---

## 3. End-to-end Flow — 7 bước xử lý (Input → Output)

Đầu vào là **một code change cần review** (diff/PR) + context (`jira_ticket`). Luồng chính:

```mermaid
flowchart TB
    IN(["📥 INPUT: change (PR/diff) + jira_ticket + target_repo + priority"])

    IN --> S1
    subgraph B1["1 · Nhận & chuẩn hoá change"]
        S1["Orchestrator + Artifact Tracker<br/>fetch diff → parse file → tạo Task review<br/>(PENDING → QUEUED)"]
    end

    S1 --> S2
    subgraph B2["2 · Dựng context"]
        S2["Context Engine<br/>file bị đụng + phụ thuộc + nội dung ticket"]
    end

    S2 --> S3
    subgraph B3["3 · Xác minh (độc lập với AI)"]
        S3["Verification Engine<br/>compile → test → lint"]
    end

    S3 --> D3{"Evidence<br/>PASSED ?"}

    D3 -- "FAILED" --> REWORK["🔁 REWORK / retry<br/>tác giả sửa → nạp change mới"]
    REWORK -. "quay lại bước 1" .-> IN

    D3 -- "PASSED" --> S4
    subgraph B4["4 · Chấm điểm"]
        S4["Attention Engine<br/>Risk + Impact + Novelty + Complexity + Confidence<br/>→ priority (CRITICAL/HIGH/MEDIUM/LOW)"]
    end

    S4 --> S5
    subgraph B5["5 · Định tuyến"]
        S5["Xếp vào review queue<br/>gán reviewer theo priority"]
    end

    S5 --> S6
    subgraph B6["6 · Con người quyết định"]
        S6["Human Review<br/>APPROVE / REJECT / REQUEST_CHANGES + rationale"]
    end

    S6 --> D6{"Decision ?"}
    D6 -- "APPROVE" --> S7
    D6 -- "REJECT / REQUEST_CHANGES" --> REWORK

    subgraph B7["7 · Lưu evidence"]
        S7["Memory / Evidence System<br/>evidence chain + decision log (append-only)"]
    end

    S7 --> OUT(["✅ OUTPUT: Quyết định review + Evidence chain truy vết được"])

    IN -. "ESCALATE (bất kỳ trạng thái)" .-> ESC["🛑 AWAITING_HUMAN_INTERVENTION"]
    IN -. "huỷ" .-> CANC["✖ CANCELLED"]
```

> **Nhánh phụ:** `REQUEST_CHANGES` → tác giả sửa → nạp change mới (quay lại bước 1). Mọi trạng thái có thể ESCALATE → `AWAITING_HUMAN_INTERVENTION`.

---

## 4. Task State Machine — 13 trạng thái canonical (Spec 2)

> **`review-reorient` note.** State machine giữ nguyên, nhưng driver dispatch/workflow/retry đã nghỉ hưu; luồng live tạo Task rồi chuyển ngay `CANCELLED`.

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> QUEUED : dependencies resolved
    QUEUED --> EXECUTING : agent picks up
    EXECUTING --> VERIFYING : agent finishes
    EXECUTING --> AWAITING_HUMAN_INTERVENTION : agent stuck / unrecoverable

    VERIFYING --> AWAITING_REVIEW : verification PASSED
    VERIFYING --> FAILED : verification FAILED

    AWAITING_REVIEW --> APPROVED : human APPROVE
    AWAITING_REVIEW --> REJECTED : human REJECT

    APPROVED --> COMPLETED
    REJECTED --> REWORK : request changes

    REWORK --> QUEUED : attempt_number +1
    REWORK --> FAILED : hết attempts

    FAILED --> REWORK : retry (còn attempt)
    FAILED --> AWAITING_HUMAN_INTERVENTION : retry limit exceeded

    COMPLETED --> [*]
    CANCELLED --> [*]

    note right of AWAITING_HUMAN_INTERVENTION
        Escalation: mọi trạng thái
        đều có thể chuyển vào đây.
    end note
    note right of CANCELLED
        Mọi trạng thái đều có thể bị huỷ.
    end note
```

**Bất biến (Spec 2):**
- Chuyển trạng thái dùng **optimistic locking** (`UPDATE ... WHERE id AND state = expected` → `StateConflictError`).
- `attempt_number` chỉ tăng khi `REWORK → QUEUED`; idempotency key = `task_id:attempt_number`.
- Mọi transition ghi vào `task_state_history` (audit).

Terminal: `COMPLETED`, `CANCELLED`.

---

## 5. Attention Engine — Logic quyết định review

```mermaid
flowchart TB
    IN2(["Change arrives for review"]) --> CALC["Tính AttentionAssessment<br/>Risk · Impact · Novelty · Complexity · Confidence"]

    CALC --> FORMULA["combined_priority =<br/>0.35·risk + 0.25·impact + 0.15·novelty<br/>+ 0.10·complexity + 0.15·(1 − confidence)"]

    FORMULA --> D{"combined_priority<br/>≥ threshold ?"}
    D -- "YES" --> REQ["🔴 REVIEW REQUIRED"]
    D -- "NO" --> POL{"Policy rules ?"}
    POL -- "ALWAYS_REVIEW" --> REQ
    POL -- "NEVER_REVIEW / auto-approve" --> AUTO["🟢 AUTO-APPROVE<br/>(skip human)"]

    REQ --> QUEUE["Vào review queue<br/>(budget + adaptive thresholds)"]
    QUEUE --> FEED["Feedback was_useful<br/>→ recalibrate weights"]
```

Labels: **CRITICAL ≥ 0.80 · HIGH ≥ 0.60 · MEDIUM ≥ 0.30 · LOW < 0.30**. Factor thiếu → redistribute trọng số + ghi `factors_unavailable`; thiếu hết → mặc định HIGH (*fail toward attention*).

---

## 6. Event-Driven Timeline — auditable

```mermaid
sequenceDiagram
    autonumber
    participant Auth as Tác giả (Dev / AI Agent)
    participant Orc as Orchestrator
    participant Ctx as Context Engine
    participant Ver as Verification Engine
    participant Att as Attention Engine
    participant Hum as Human Reviewer
    participant Evi as Memory / Evidence

    Auth->>Orc: nạp change (PR / diff) + ticket
    Orc->>Orc: tạo Task → task.created
    Orc->>Orc: chuyển CANCELLED (task.state_changed — review-only)
    Orc->>Ctx: dựng context (context snapshot)
    Orc->>Ver: trigger verification → verification.completed
    Ver-->>Orc: PASSED / FAILED (evidence)
    Orc->>Att: assessChange (nếu PASSED)
    Att-->>Orc: attention.assessment_created + item_routed
    Orc->>Hum: AWAITING_REVIEW → review queue
    Hum-->>Orc: review.decision_submitted (APPROVE / REJECT)
    Orc->>Evi: lưu evidence + decision log + review report
```

Mọi event persist **append-only** vào `event_log` (idempotent), join theo `correlation_id`.

Envelope chuẩn: `{ event_id (UUIDv7), event_type, event_version, occurred_at, correlation_id, payload }` — naming `<domain>.<entity>_<verb_past_tense>`.

---

## 7. Kiến trúc 4 lớp

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

## 8. Lộ trình (đã hoàn tất)

Toàn bộ lộ trình xây dựng (Core Loop → Calibrate & Measure → Learn & Automate) đã hoàn tất, tagged `v0.4.0-harness` (`EXIT-WITH-CARRYFORWARD`, 8/9 exit criteria). Lịch sử phân kỳ theo ngày (`docs/plan/`) đã được gỡ bỏ; tổng kết exit ở `docs/retros/phase3-exit-review.md`.