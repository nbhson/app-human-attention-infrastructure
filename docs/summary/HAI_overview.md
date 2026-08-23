# Tổng quan Kiến trúc HAI Harness

## Tổng quan

**Human Attention Infrastructure (HAI) Harness** — nền tảng AI-native quản lý và tối ưu hóa "sự chú ý của con người" trong quy trình phát triển phần mềm: AI tạo ra công việc, Harness quan sát, xác minh, đánh giá, xếp ưu tiên và định tuyến tới đúng sự chú ý của con người.

---

## Vấn đề cốt lõi

> **AI tạo ra thay đổi phần mềm nhanh hơn con người có thể kiểm tra và xác thực. Sự chú ý của con người trở thành nút cổ chai.**

Kiến trúc biến "sự chú ý" thành tài nguyên có thể đo lường, định tuyến và tối ưu hóa.

---

## Đầu vào & Luồng xử lý (Input → Kết quả)

### 1. Input — cái gì đi vào hệ thống

Đầu vào là một **code change cần review** cùng ngữ cảnh của nó — không phải "yêu cầu phải làm gì". Change có thể đến từ bên ngoài (PR/MR của người khác hoặc agent AI khác) hoặc từ chính Agent Runtime của HAI (Spec 3) khi HAI tự sinh fix; ở ranh giới input, HAI luôn nhận **một change để review**.

| Trường | Kiểu | Mô tả | Ví dụ |
|--------|------|-------|-------|
| `change` | diff / commit | Nội dung thay đổi cần review (diff text, commit SHA, hoặc branch) | `"HEAD~1..HEAD"` |
| `pr_id` *(thay `change`)* | string | Số + URL Pull / Merge Request — HAI tự fetch diff + metadata | `"#482"`, `https://github.com/acme/api/pull/482` |
| `jira_ticket` | string | Ticket tương ứng — tiêu chí & context để đối chiếu ("change có giải quyết đúng ticket không") | `"ACME-1234"` |
| `target_repo` | string | Repo chứa change | `github.com/acme/api` |
| `priority` *(tuỳ chọn)* | enum | `CRITICAL / HIGH / MEDIUM / LOW` | `HIGH` |
| `policy` *(tuỳ chọn)* | object | retry · timeout · `approval_gate` | `{ approval_gate: true }` |

> `change` và `pr_id` là hai cách nạp cùng một thứ: **code change cần review**. `jira_ticket` mang "yêu cầu gốc" để đối chiếu khi review.

Ví dụ payload:

```json
{
  "pr_id": "https://github.com/acme/api/pull/482",
  "jira_ticket": "ACME-1234",
  "target_repo": "github.com/acme/api",
  "priority": "HIGH"
}
```

### 2. Progress — sau khi có input thì ra kết quả thế nào

Input (change + ticket) đi qua 7 bước, mỗi bước chạy khi bước trước hoàn tất:

1. **Nhận & chuẩn hoá change** *(Orchestrator + Artifact Tracker)* — fetch diff từ PR (hoặc nhận diff trực tiếp), parse file thay đổi, tạo `Task` review (`PENDING → QUEUED`).
2. **Dựng context** *(Context Engine)* — phân tích file bị đụng + phụ thuộc liên quan + nội dung Jira ticket.
3. **Xác minh** *(Verification)* — `compile → test → lint` trên change, chạy độc lập → evidence `PASSED / FAILED`.
4. **Chấm điểm** *(Attention)* — `Risk/Impact/Novelty/Complexity/Confidence` → priority.
5. **Định tuyến** *(Attention)* — xếp vào review queue, gán reviewer theo priority.
6. **Con người quyết định** *(Human Review)* — `APPROVE` / `REJECT` / `REQUEST_CHANGES` + rationale.
7. **Lưu evidence** *(Memory/Evidence)* — mọi claim kèm evidence, append-only, truy vết theo `correlation_id`.

Nhánh phụ: `REQUEST_CHANGES` → tác giả sửa → nạp change mới (quay lại bước 1); mọi trạng thái có thể ESCALATE → `AWAITING_HUMAN_INTERVENTION`.

### 3. Kết quả — cái gì đi ra

- **APPROVE:** quyết định review + **Evidence chain** (compile/test/lint + provenance) truy vết được.
- **REJECT / REQUEST_CHANGES:** quyết định + rationale gửi lại tác giả.
- **Luôn ghi:** event log + decision log — nền cho Phase 2 *đo* và Phase 3 *học* (tinh chỉnh calibration/routing từ tín hiệu `was_useful`).

---

## Mô hình kiến trúc 4 lớp

```
┌─────────────────────────────────────────┐
│         HUMAN ATTENTION                 │  ← Con người ra quyết định
├─────────────────────────────────────────┤
│     HUMAN ATTENTION LAYER               │  ← Review queue, ưu tiên, routing
├─────────────────────────────────────────┤
│          HAI CORE PLATFORM              │  ← Orchestration, Engines, Evidence
├─────────────────────────────────────────┤
│     INTEGRATION / INFRASTRUCTURE        │  ← Git, CI/CD, LLM Providers
└─────────────────────────────────────────┘
```

---

## 11 Phân hệ cốt lõi

| # | Phân hệ | Package | Vai trò |
|---|---------|---------|---------|
| 1 | **HAI Harness Architecture** | `docs/core/1_...` | Kiến trúc tổng thể, nguyên tắc, ranh giới module, lộ trình 3 phase |
| 2 | **Task/Work Orchestrator** | `@harness/orchestrator` | State machine 13 trạng thái, dispatch, workflow, retry |
| 3 | **AI Agent Runtime** | `@harness/agent-runtime` | Thực thi agent (ReAct loop), ghi trajectory từng bước, tool sandbox |
| 4 | **Context Engine** | `@harness/context-engine` | Chọn lọc context relevant theo budget token, freshness, cache |
| 5 | **Artifact/Change Tracker** | `@harness/artifact-tracker` | Provenance: ai thay đổi gì, tại sao, evidence nào; snapshot content-addressed |
| 6 | **Attention Engine** 🔑 | `@harness/attention-engine` | Tính Risk/Impact/Novelty/Complexity/Confidence → priority → routing + auto-approve |
| 7 | **Verification Engine** | `@harness/verification-engine` | Xác minh độc lập với AI: compile, test, sandbox — kèm evidence |
| 8 | **Human Review Interface** | `@harness/review` (+ `apps/web`) | UI quyết định: APPROVE/REJECT + rationale |
| 9 | **Memory/Evidence System** | `@harness/domain` (events) + `db.event_log` | Claim ≠ Evidence; evidence append-only, bất biến |
| 10 | **Observability/Governance** | `@harness/observability` | Audit trail, metrics, policy enforcement |
| 11 | **Evaluation Engine** 🔁 | `@harness/evaluation` | Đo pipeline (precision/recall, attention efficiency), A/B harness, calibration |

Tài liệu as-built cho từng phân hệ hiện nằm trong **`README.md` của mỗi package** (`packages/*/README.md`) — các file `docs/core/2_...` → `11_...` đã được gỡ bỏ, chỉ giữ lại duy nhất spec kiến trúc `docs/core/1_...`. Xem bảng ánh xạ subsystem→package trong Architecture §5.

> **Đối chiếu kỹ thuật nguồn:** xem `docs/summary/harness-fit-analysis.md` — bản đồ từ `AI-coding-skills-framework/harness` (11 chuyên đề + 4 mẫu DeepSeek Harness) sang 11 subsystem HAI: phần nào *đã hấp thụ*, phần nào *bổ sung* (kèm spec + phase), phần nào *tham khảo / loại*.

---

## Nguyên tắc kiến trúc then chốt

1. **Human Attention là tài nguyên first-class** — tối ưu review time, cognitive load, decision quality, không chỉ CPU/memory/latency
2. **AI là execution component, không phải authority** — AI đề xuất, Harness quyết định mức trusted/risky/reviewable
3. **Evidence trước confidence** — "Đây là evidence" > "AI nói nó đúng". Bất biến: *mọi report PASSED phải có ≥ 1 evidence row*
4. **Claim ≠ Evidence** — mọi claim phải truy vết được tới nguồn (provenance chain đầy đủ)
5. **Mọi thứ quan trọng đều observable** — mỗi operation tạo event có `correlation_id`, join được với audit log
6. **Modular core, replaceable integrations** — interface-based (LLMProvider, Tokenizer, Ranker...), engines không import lẫn nhau

---

## Domain Objects chính

### Task — 12 trạng thái canonical (Spec 2, nguồn sự thật duy nhất)

```
PENDING → QUEUED → EXECUTING → VERIFYING → AWAITING_REVIEW
                                              ↓         ↓
                                        APPROVED    REJECTED
                                              ↓         ↓
                                        COMPLETED    REWORK → QUEUED (attempt+1)
                                              hoặc FAILED (hết attempts)

Mọi trạng thái → AWAITING_HUMAN_INTERVENTION (escalation)
Mọi trạng thái → CANCELLED
Terminal: COMPLETED, CANCELLED
```

- Chuyển trạng thái dùng **optimistic locking** (`UPDATE ... WHERE id AND state = expected` → `StateConflictError`)
- `attempt_number` chỉ tăng khi REWORK → QUEUED; idempotency key = `task_id:attempt_number`
- Mọi transition ghi vào `task_state_history` (audit)

### Attention Assessment (Spec 6 — công thức đã sửa)

```
combined_priority = w_risk·risk + w_impact·impact + w_novelty·novelty
                  + w_complexity·complexity + w_confidence·(1 − confidence_score)
```

- Weights (placeholder, KHÔNG tune khi chưa có data): 0.35 / 0.25 / 0.15 / 0.10 / 0.15
- Labels: **CRITICAL ≥ 0.80 · HIGH ≥ 0.60 · MEDIUM ≥ 0.30 · LOW < 0.30**
- Factor thiếu → redistribute trọng số, ghi `factors_unavailable`; thiếu hết → mặc định HIGH (fail toward attention)
- **Alert Fatigue (§4.1)**: daily review budget, adaptive thresholds (bounded [0.60, 0.80]), inflation monitor, feedback loop (`was_useful`)

### Artifact / Change (Spec 5)

- Artifact: `PENDING | VERIFIED | REVIEWED | MERGED | ROLLED_BACK`
- Change: `PENDING → VERIFIED → REVIEWED`, mọi trạng thái → `ROLLED_BACK`
- Chuyển trạng thái **chỉ qua events** (ChangeStatusSubscriber), guarded UPDATE idempotent
- Snapshot content-addressed (`id = sha256(content)` → dedup miễn phí)
- **Quan hệ với Git (§3.1)**: Tracker là source of truth *trước commit*; Git là source of truth *sau merge*. Không shell out tới git từ package này.

### Verification (Spec 7)

- CheckKind: `COMPILE | TEST | LINT` · CheckStatus: `PASSED | FAILED | FLAKY | TIMED_OUT | SKIPPED`
- Timeout 2 tầng (per-check vs request-level); flaky retry-once (fail→pass = FLAKY, report PASSED + `flaky: true`)
- Phase 1: chạy in-process trong worktree riêng, `sanitizedEnv()` loại secrets, output cap 64KB
- Overall PASSED ⟺ mọi check ∈ {PASSED, FLAKY}; FAILED → task REWORK

### Context (Spec 4)

- Phase 1: `relevance_score = 0.7·keyword_overlap + 0.3·dependency_proximity` (semantic/recency/history = 0 tới Phase 3; Ranker interface là seam)
- Phase 2: dựng infra semantic (pgvector + Embedder) ở chế độ shadow/experimental (đo qua A/B harness) — chưa là default
- Phase 3: hybrid search (keyword + embeddings) + RRF + re-ranking (heuristic ngôn ngữ: dependency/recency/usage) thành default + RAG Fusion
- Tokenizer Phase 1: chars/4; budget trimmer không bao giờ drop target files
- Freshness: re-hash sources vs `content_hash` → FRESH/STALE; STALE → re-resolve, agent đang chạy chỉ nhận warning

---

## Event-Driven Model

Envelope chuẩn (Spec 2 §8):

```ts
{ event_id: UUIDv7, event_type, event_version, occurred_at (UTC), correlation_id, payload }
```

Naming: `<domain>.<entity>_<verb_past_tense>`. Luồng chuẩn:

```
task.created → task.state_changed (×N) → artifact.created → verification.completed
→ attention.assessment_created → attention.item_routed → review.decision_submitted
→ artifact.merged → task.completed
```

Mọi event persist append-only vào `event_log` (idempotent), join theo `correlation_id`.

---

## Tech Stack đã chốt (Phase 1)

| Tầng | Lựa chọn |
|------|----------|
| Kiến trúc | **Modular monolith** (không microservices) |
| Ngôn ngữ / monorepo | TypeScript, pnpm workspaces + Turborepo |
| Data | PostgreSQL 16 + Drizzle ORM (text PKs, timestamptz, jsonb, CHECK constraints) |
| API / Web | Fastify · React + Vite |
| Events | In-process IEventBus (EventEmitter) sau interface — thay thế được |
| Test | Vitest (integration test dùng schema `harness_test` riêng) |
| Infra | Docker Compose (postgres:16-alpine) |
| LLM | LLMProvider adapter: Anthropic SDK + MockLLM (test) |

Repo: `apps/api`, `apps/web`, `packages/{domain, event-bus, db, di, orchestrator, agent-runtime, context-engine, artifact-tracker, attention-engine, verification-engine, review}`.

**Dependency rules (enforce bằng eslint-plugin-boundaries + architecture tests):** domain không import gì; event-bus → domain; db → domain+event-bus; **engines không bao giờ import lẫn nhau**; apps import tất cả.

---

## Tech Stack — Phase 2 (Calibrate & Close the Measurement Loop)

Bổ sung / thay thế trên nền Phase 1 (vẫn **modular monolith**, **Postgres-centric**; chỉ thêm infra thay thế được đằng sau các seam đã khai báo):

| Tầng | Lựa chọn | Ghi chú |
|------|----------|---------|
| Data | PostgreSQL 16 + **`pgvector`** (embeddings), `pg_trgm`/FTS (BM25 lexical) | Semantic search infra (shadow) — Context §5.1; không cần vector-DB riêng |
| Tokenizer | Tokenizer chính xác (tiktoken / provider-specific) | Thay counter `chars/4` (Context §8) |
| Embeddings | `Embedder` interface (provider adapter) | Nạp sau seam `Retriever`/`Ranker` |
| Context cache | Cache theo `source_id + content_hash` | Context §5.2.3 |
| Object store | S3/MinIO cho artifact lớn (content-addressed) | Spec 5 §4.2 ContentStore (Phase 2+) |
| Evaluation | Offline metrics + **shadow A/B harness** (replay trajectory) | Spec 3 §6.1 · Spec 11 §5 |
| Observability/Governance | Metrics + audit trail + policy → promote **Spec 10** | OpenTelemetry-ready |
| Auth | SSO thật (OIDC provider) | Thay header `X-Reviewer-Id` (day-30 P0) |
| Sandbox | Git worktree / **container** per verification & agent run | Spec 7 §5.5 · Spec 3 §14.3 (Code-Mode) |

---

## Tech Stack — Phase 3 (Learn & Automate Under Guardrails)

Bổ sung trên nền Phase 2:

| Tầng | Lựa chọn | Ghi chú |
|------|----------|---------|
| Code index | Symbol index + **dependency graph** (tree-sitter / code parser) | Targeted / incremental verification (Spec 7 §5.2–5.3) |
| Retrieval | Hybrid (BM25 + embeddings) + RRF + re-rank, optional **RAG Fusion** | Context §5.1–5.2 |
| Memory | Write-back + consolidation / decay / archive (Postgres) | Memory §4.5 |
| Multi-agent | Bounded autonomous loops + critique/revision (**không** thay Human) | Non-goal hoá ở Phase 1 |
| Benchmark | Container runtime minimal-tools (bash + editor) + corpus gold labels | Spec 11 §5.1–5.2 |
| Judge | LLM-as-judge sau `LLMProvider` (rubric-scored, audit) | Spec 11 §5.1 |
| Queue (tuỳ chọn) | Durable queue (Redis/SQS) thay in-process hand-off | Orchestrator §6 — **không** đổi event contract |

> **Bất biến qua mọi phase:** kiến trúc vẫn **modular monolith** (không microservices/K8s); Events vẫn qua `IEventBus` interface; dependency rules của domain/engines giữ nguyên như Phase 1. Phase 2–3 chỉ **mở rộng infrastructure đằng sau seam**, không thay đổi hợp đồng.

---

## Lộ trình (3 Phase)

```text
PHASE 1 — Prove the Core Loop (30 ngày, hiện tại)
    Task → Context → Agent → Artifact → Verification
         → Attention → Human Review → Decision → Evidence

PHASE 2 — Calibrate & Close the Measurement Loop
    Evaluation Engine v0 (metrics + A/B harness — shadow, replay trajectory từ Spec 3)
    Calibrate Attention weights từ data `was_useful` thật
    Semantic search infra (pgvector + Embedder) — shadow/experimental, sau Ranker seam
    Auto-approve (sau flag + sampling audit khi calibration đạt ngưỡng)
    Promote Human Review (8) & Observability (10) → spec riêng

PHASE 3 — Learn & Automate Under Guardrails
    Memory/Evidence system đầy đủ (retrieval, decision memory, expiration + versioned write-back)
    Targeted / incremental verification (dependency graph)
    Context ranking hybrid thành default (BM25 + embeddings + RRF + re-rank) + RAG Fusion
    Multi-agent orchestration + bounded autonomous loops
    Trajectory fork (so sánh model/prompt/context head-to-head) + resume (crash recovery)
    Benchmark corpus (gold labels versioned) + LLM-as-judge (rubric-scored, có audit trail)
    Đóng vòng: Evaluate → Calibrate → Deploy → Observe
```

- **Kế hoạch Phase 1** (`docs/plan/phase-1/`) — 30 ngày, 4 tuần: Foundation → Execution core → Trust pipeline → Human loop + E2E, hard checkpoint ngày 7/14/21.
- **Kế hoạch Phase 2** (`docs/plan/phase-2/`) — 30 ngày, 6 tuần: Identity/Observability → Evaluation v0 + A/B harness → calibration + auto-approve → semantic infra (shadow) → sandbox/object-store/Spec 8 → exit review.
- **Kế hoạch Phase 3** (`docs/plan/phase-3/`) — 40 ngày, 8 tuần: Memory + trajectory → dependency-graph targeted verify → hybrid context default → multi-agent bounded → benchmark + judge → đóng loop Learning.
- **Milestone then chốt** (Spec 1 §24): `AI Change → Evidence → Risk → Human Attention → Decision → Learning`. Phase 1 chứng minh loop trừ bước *Learning* (vẫn thủ công); Phase 2 đo được pipeline; Phase 3 tự động đóng Learning.
- **Exit criteria**: Phase 1→2 khi loop demo được end-to-end + evidence queryable; Phase 2→3 khi có metrics precision/recall + calibration từ data thật; Phase 3 khi bước Learning tự đóng.

---

## Những KHÔNG build trong Phase 1

- Multi-agent orchestration phức tạp · RAG/vector DB · UI sophisticated · autonomous loops · microservices/K8s
- Auto-approve thật (r5 chỉ set flag) · SSO/auth thật (Phase 2 P0: hiện chỉ `X-Reviewer-Id` header)
- Semantic ranking, targeted/incremental verification (Phase 2–3, đã có seam trong interface)

---

## Trạng thái hiện tại so với lần review đầu

Các điểm "cần lưu ý" trước đây nay đã được giải quyết trong specs:

- ✅ **Schema domain objects** — đã định nghĩa đầy đủ (12 task states, artifact/change lifecycle, evidence model, event envelope)
- ✅ **Data storage strategy** — PostgreSQL 16 cho tất cả; conventions rõ ràng; evidence append-only
- ✅ **Error handling & fallback** — FailureClass (TRANSIENT/PERMANENT/RESOURCE), retry policy, escalation → AWAITING_HUMAN_INTERVENTION
- ✅ **Spec 9 (Memory/Evidence) & Spec 11 (Evaluation Engine)** — đã formalize từ các ghi chú "Phase sau" thành spec riêng: Evidence store append-only (Phase 1) và Evaluation seam (Phase 2+)
- ⚠️ **Auth** — vẫn là Phase 2 (P0 trong backlog, xem `docs/plan/phase-3/backlog.md`)

**Kết luận:** Kiến trúc giữ nguyên hướng đi đúng (tập trung human attention bottleneck, evidence > confidence), nay đã đủ chi tiết để implement — với 11 phân hệ (state machine chặt chẽ, event model có audit trail), lộ trình 3 phase rõ ràng, và kế hoạch 30 ngày (Phase 1) từng bước trong `docs/plan/`.
