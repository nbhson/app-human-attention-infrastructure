# Tổng quan Kiến trúc HAI Harness

> **`review-reorient` (v0.6):** đường code-generation đã _nghỉ hưu_. Sản phẩm giờ là control plane **review PR/MR bên ngoài** (Bitbucket/GitLab/GitHub + Jira): AI đóng vai _reviewer chứ không phải author_ — đọc diff + requirement, trả report + findings + _fix suggestions_. Các mô tả "AI sinh code / tự sửa fix" ở các mục dưới chỉ còn là lịch sử thiết kế; phần machinery được giữ (state machine, attention routing, verification, evidence) vẫn dùng lại nguyên trạng.

> **Hoàn tất (`v0.4.0-harness`):** MCP connectivity (GitHub/GitLab/Bitbucket/Jira qua một `mcp.config.json`, token qua env — không inline), write-back có toggle + `writeback_log`, review memory, LLM-as-judge + inter-judge agreement, và learning loop đóng. Exit review **8/9 tiêu chí** — còn 1 mục _hybrid search làm default_ được carry-forward (Day-29 A/B trả HOLD, `keyword` vẫn là default). Xem `docs/retros/phase3-exit-review.md`.

## Tổng quan

**Human Attention Infrastructure (HAI) Harness** — nền tảng AI-native quản lý và tối ưu hóa "sự chú ý của con người" trong quy trình phát triển phần mềm: một code change (PR/MR — do con người hoặc AI khác tạo) đi vào, Harness quan sát, xác minh, đánh giá, dùng AI làm reviewer, xếp ưu tiên và định tuyến tới đúng sự chú ý của con người.

---

## Vấn đề cốt lõi

> **AI tạo ra thay đổi phần mềm nhanh hơn con người có thể kiểm tra và xác thực. Sự chú ý của con người trở thành nút cổ chai.**

Kiến trúc biến "sự chú ý" thành tài nguyên có thể đo lường, định tuyến và tối ưu hóa.

---

## Đầu vào & Luồng xử lý (Input → Kết quả)

### 1. Input — cái gì đi vào hệ thống

Đầu vào là một **code change cần review** cùng ngữ cảnh của nó — không phải "yêu cầu phải làm gì". Change đến từ bên ngoài qua PR/MR (GitHub hôm nay qua REST; GitLab/Bitbucket/Jira nối qua **MCP** — một client + một file config, không build REST SDK từng host); ở ranh giới input, HAI luôn nhận **một change để review**.

| Trường                     | Kiểu   | Mô tả                                                                                         | Ví dụ                                  |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| `pr_url`                   | string | URL Pull / Merge Request — HAI tự fetch diff + metadata                                       | `https://github.com/acme/api/pull/482` |
| `jira_ticket` _(tuỳ chọn)_ | string | Ticket tương ứng — tiêu chí & context để đối chiếu ("change có giải quyết đúng ticket không") | `"ACME-1234"`                          |

> **Review-only flow:** Harness nhận URL PR, fetch diff qua MCP, fetch ticket (nếu có), hỏi AI review, và trả về report + findings + fix suggestions. Không có code generation, không có auto-commit.

### 2. Progress — sau khi có input thì ra kết quả thế nào

Input (PR URL + ticket) đi qua các bước, mỗi bước chạy khi bước trước hoàn tất:

1. **Fetch diff + requirement** _(GitProvider + TicketProvider via MCP)_ — fetch PR diff, metadata (files, base/head SHA), và ticket requirement (Jira).
2. **Tạo Task anchor** _(Orchestrator)_ — tạo `Task` review, chuyển ngay `CANCELLED` (anchor provenance, không dispatch).
3. **Xây dựng context** _(Context Engine)_ — collect → rank → trim sources (keyword/hybrid/RAG Fusion), inject review memory.
4. **AI Review** _(ReviewAgent)_ — model đọc diff + context, trả JSON: summary + overallVerdict + findings[] + suggestions[].
5. **Verification** _(VerificationEngine)_ — clone PR vào Docker sandbox, chạy `build` + `test` của clone. FAILED → flag report, không sửa code.
6. **Attention scoring** _(Attention Engine)_ — tính 5 factors → combinedPriority → label (CRITICAL/HIGH/MEDIUM/LOW) → route.
7. **Human decision** _(Review UI)_ — người xem report, approve/reject/comment + rationale.
8. **Write-back** _(WriteBackService)_ — nếu armed, comment/status lên PR + transition lên Jira (toggle-gated).
9. **Memory ingest** _(MemoryIngestor)_ — distill finding/decision thành memory entries.

Nhánh phụ: `REQUEST_CHANGES` → tác giả sửa → tái review; mọi trạng thái có thể ESCALATE → `AWAITING_HUMAN_INTERVENTION`.

### 3. Kết quả — cái gì đi ra

- **APPROVE:** quyết định review + **Evidence chain** (compile/test/sandbox + provenance) truy vết được.
- **REJECT / REQUEST_CHANGES:** quyết định + rationale gửi lại tác giả.
- **Luôn ghi:** event log + decision log + `review_reports`/`review_findings`/`fix_suggestions` — nền cho việc _đo_ và _học_ (tinh chỉnh calibration/routing từ tín hiệu `was_useful`).

### 4. Bề mặt report — attention metric & Breakdown (`review-reorient`)

Report giờ trả một con số "needs human attention" **chứng minh được** chứ không phải cảm tính:

- **Tính theo file, không theo dòng:** `flaggedFiles / totalFiles` — `totalFiles` đếm mọi file do con người viết (source + docs/config/infra; chỉ loại generated như lockfile / `dist/`), `flaggedFiles` đếm file có ≥1 finding `CRITICAL / MAJOR / MINOR` (NIT / INFO **không** tính).
- **File bị flag được liệt kê tên + severity** ngay trên report → "3 trong 12 file" map 1-1 với danh sách findings bên dưới.
- Tab **Breakdown** trình bày phép tính: file bị flag kèm severity, findings "có tính" vs rác NIT/INFO, và bảng split lines theo `test / style / markup / source / config`; chỉ generated files bị loại.

Prompt reviewer review **mọi file do con người viết** — source, docs (README), config (YAML/Dockerfile/.env/CI) và infra — trừ generated files; secret trong `.env`/Compose được **redact** trước khi vào context model. Yêu cầu tìm lỗi đúng đắn / bug ẩn / clean code, và cả lỗi misconfig/security ở config/infra — không báo nitpick (như thiếu trailing newline…).

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

| #   | Phân hệ                      | Package                                              | Vai trò                                                                                       |
| --- | ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | **HAI Harness Architecture** | `docs/architecture/HAI_Harness_Architecture_v0.6.md` | Kiến trúc tổng thể, nguyên tắc, ranh giới module, lộ trình (đã hoàn tất)                      |
| 2   | **Task/Work Orchestrator**   | `@harness/orchestrator`                              | State machine 13 trạng thái + `TaskService` (dispatch/workflow/retry đã nghỉ hưu)             |
| 3   | **AI Reviewer**              | `@harness/agent-runtime`                             | Lớp `LLMProvider` + `ReviewAgent` — AI review read-only (report + findings + fix suggestions) |
| 4   | **Context Engine**           | `@harness/context-engine`                            | Chọn lọc context relevant theo budget token, freshness, cache                                 |
| 5   | **Artifact/Change Tracker**  | `@harness/artifact-tracker`                          | Provenance: ai thay đổi gì, tại sao, evidence nào; snapshot content-addressed                 |
| 6   | **Attention Engine** 🔑      | `@harness/attention-engine`                          | Tính Risk/Impact/Novelty/Complexity/Confidence → priority → routing + auto-approve            |
| 7   | **Verification Engine**      | `@harness/verification-engine`                       | Xác minh độc lập với AI: compile, test, sandbox — kèm evidence                                |
| 8   | **Human Review Interface**   | `@harness/review` (+ `apps/web`)                     | UI quyết định: APPROVE/REJECT + rationale                                                     |
| 9   | **Memory/Evidence System**   | `@harness/domain` (events) + `db.event_log`          | Claim ≠ Evidence; evidence append-only, bất biến                                              |
| 10  | **Observability/Governance** | `@harness/observability`                             | Audit trail, metrics, policy enforcement                                                      |
| 11  | **Evaluation Engine** 🔁     | `@harness/evaluation`                                | Đo pipeline (precision/recall, attention efficiency), A/B harness, calibration                |

Tài liệu as-built cho từng phân hệ hiện nằm trong **`README.md` của mỗi package** (`packages/*/README.md`) — các file `docs/core/2_...` → `11_...` đã được gỡ bỏ, chỉ giữ lại duy nhất spec kiến trúc `docs/architecture/HAI_Harness_Architecture_v0.6.md`. Xem bảng ánh xạ subsystem→package trong Architecture §6.

> **Đối chiếu kỹ thuật nguồn:** xem `docs/summary/harness-fit-analysis.md` — bản đồ từ `AI-coding-skills-framework/harness` (11 chuyên đề + 4 mẫu DeepSeek Harness) sang 11 subsystem HAI: phần nào _đã hấp thụ_, phần nào _bổ sung_ (kèm spec + phase), phần nào _tham khảo / loại_.

---

## Nguyên tắc kiến trúc then chốt

1. **Human Attention là tài nguyên first-class** — tối ưu review time, cognitive load, decision quality, không chỉ CPU/memory/latency
2. **AI là execution component, không phải authority** — AI đề xuất, Harness quyết định mức trusted/risky/reviewable
3. **Evidence trước confidence** — "Đây là evidence" > "AI nói nó đúng". Bất biến: _mọi report PASSED phải có ≥ 1 evidence row_
4. **Claim ≠ Evidence** — mọi claim phải truy vết được tới nguồn (provenance chain đầy đủ)
5. **Mọi thứ quan trọng đều observable** — mỗi operation tạo event có `correlation_id`, join được với audit log
6. **Modular core, replaceable integrations** — interface-based (LLMProvider, Tokenizer, Ranker...), engines không import lẫn nhau

---

## Domain Objects chính

### Task — 13 trạng thái canonical (Spec 2, nguồn sự thật duy nhất)

> **`review-reorient` note.** State machine được giữ nguyên (states + transitions + optimistic locking), nhưng các _driver_ di chuyển task qua `EXECUTING → VERIFYING` (dispatch/workflow/retry) đã nghỉ hưu cùng code-gen. Luồng live hôm nay: review slice tạo Task rồi chuyển ngay `CANCELLED` (`transitionTask(..., Cancelled, 'human', { rationale: 'review-only task handled by the review slice' })`).

```
PENDING → QUEUED → CANCELLED        ← live review-only path (anchor + done)
                        ↕
EXECUTING → VERIFYING → AWAITING_REVIEW → APPROVED → COMPLETED
                              ↓
                         REJECTED → REWORK → QUEUED
                              ↓
                         FAILED (hết attempts)
                        hoặc AWAITING_HUMAN_INTERVENTION
```

- Chuyển trạng thái dùng **optimistic locking** (`UPDATE ... WHERE id AND state = expected` → `StateConflictError`)
- `attempt_number` chỉ tăng khi REWORK → QUEUED; idempotency key = `task_id:attempt_number`
- Mọi transition ghi vào `task_state_history` (audit)

> **Lưu ý:** Trong review-only mode, `EXECUTING`/`VERIFYING` là các state lịch sử — vẫn tồn tại trong schema nhưng không còn được driver nào sử dụng. Task review được `CANCELLED` ngay sau `QUEUED`.

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
- **Quan hệ với Git (§3.1)**: Tracker là source of truth _trước commit_; Git là source of truth _sau merge_. Không shell out tới git từ package này.

### Verification (Spec 7)

- CheckKind: `COMPILE | TEST | LINT` · CheckStatus: `PASSED | FAILED | FLAKY | TIMED_OUT | SKIPPED`
- Timeout 2 tầng (per-check vs request-level); flaky retry-once (fail→pass = FLAKY, report PASSED + `flaky: true`)
- Container sandboxed (`DockerSandbox`): `--network none`, `--read-only rootfs`, `--user 1000:1000`, `--cap-drop ALL`
- Overall PASSED ⟺ mọi check ∈ {PASSED, FLAKY}; FAILED → flag report (không gate decision)

### Context (Spec 4)

- Default ranking: `KeywordDependencyRanker` (keyword overlap + dependency proximity)
- Shadow: semantic (pgvector + Embedder) + hybrid (BM25 + embeddings + RRF) + RAG Fusion — all selectable per-request via `rank_method`, none is default
- Tokenizer: exact `tiktoken` per model, budget trimmer never drops target files
- Freshness: re-hash sources vs `content_hash` → FRESH/STALE; STALE → re-resolve

---

## Event-Driven Model

Ensemble chuẩn (Spec 2 §8):

```ts
{
  event_id: (UUIDv7),
  event_type: string,
  event_version: string,
  occurred_at: UTC timestamp,
  correlation_id: string,  // == tasks.id
  payload: Record<string, unknown>
}
```

Naming: `<domain>.<entity>_<verb_past_tense>`. Luồng chuẩn cho review slice:

```
task.created → task.state_changed(PENDING→CANCELLED)
→ review.requested → review.report_created
→ attention.assessment_created → attention.item_routed
→ review.decision_submitted → integration.writeback_completed
→ memory.entry_created
```

Mọi event persist append-only vào `event_log` (idempotent), join theo `correlation_id`.

---

## Tech Stack đã chốt

| Tầng                | Lựa chọn                                                                      |
| ------------------- | ----------------------------------------------------------------------------- |
| Kiến trúc           | **Modular monolith** (không microservices)                                    |
| Ngôn ngữ / monorepo | TypeScript, pnpm workspaces + Turborepo                                       |
| Data                | PostgreSQL 16 + Drizzle ORM (text PKs, timestamptz, jsonb, CHECK constraints) |
| API / Web           | Fastify · React + Vite                                                        |
| Events              | In-process IEventBus (EventEmitter) sau interface — thay thế được             |
| Test                | Vitest (integration test dùng schema `harness_test` riêng)                    |
| Infra               | Docker Compose (postgres:16-alpine)                                           |
| LLM                 | LLMProvider adapter: Anthropic SDK + OpenAI-compatible + MockLLM (test)       |

Repo: `apps/api`, `apps/web`, `packages/{domain, event-bus, db, di, orchestrator, agent-runtime, context-engine, artifact-tracker, attention-engine, verification-engine, review}`.

**Dependency rules (enforce bằng eslint-plugin-boundaries + architecture tests):** domain không import gì; event-bus → domain; db → domain+event-bus; **engines không bao giờ import lẫn nhau**; apps import tất cả.

---

## Tech Stack — Calibrate & Close the Measurement Loop

Bổ sung / thay thế trên nền ban đầu (vẫn **modular monolith**, **Postgres-centric**; chỉ thêm infra thay thế được đằng sau các seam đã khai báo):

| Tầng                     | Lựa chọn                                                                  | Ghi chú                                                                  |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Data                     | PostgreSQL 16 + **`pgvector`** (embeddings), `pg_trgm`/FTS (BM25 lexical) | Semantic search infra (shadow) — Context §5.1; không cần vector-DB riêng |
| Tokenizer                | Tokenizer chính xác (tiktoken / provider-specific)                        | Thay counter `chars/4` (Context §8)                                      |
| Embeddings               | `Embedder` interface (provider adapter)                                   | Nạp sau seam `Retriever`/`Ranker`                                        |
| Context cache            | Cache theo `source_id + content_hash`                                     | Context §5.2.3                                                           |
| Object store             | S3/MinIO cho artifact lớn (content-addressed)                             | Spec 5 §4.2 ContentStore                                                 |
| Evaluation               | Offline metrics + **shadow A/B harness** (replay trajectory)              | Spec 3 §6.1 · Spec 11 §5                                                 |
| Observability/Governance | Metrics + audit trail + policy → promote **Spec 10**                      | OpenTelemetry-ready                                                      |
| Auth                     | SSO thật (OIDC provider)                                                  | Thay header `X-Reviewer-Id` (day-30 P0)                                  |
| Sandbox                  | Docker container per verification & agent run                             | Spec 7 §5.5 · Spec 3 §14.3 (Code-Mode)                                   |

---

## Tech Stack — Learn & Automate Under Guardrails

Bổ sung trên nền trước:

| Tầng                 | Lựa chọn                                                                                                             | Ghi chú                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Git/ticket providers | **MCP** — 1 client `@harness/mcp` + **1 file config** `mcp.config.json` (stdio/SSE) nối GitHub/GitLab/Bitbucket/Jira | Dùng MCP server có sẵn trên hệ sinh thái; **không** tự build REST SDK từng host |
| AI model             | **Giữ nguyên** — api key + provider + base URL + model (`provider_configs`)                                          | MCP chỉ thay tầng _tools_, không thay kết nối model                             |
| Code index           | Symbol index + **dependency graph** (tree-sitter / code parser)                                                      | Targeted / incremental verification (Spec 7 §5.2–5.3)                           |
| Retrieval            | Hybrid (BM25 + embeddings) + RRF + re-rank, optional **RAG Fusion**                                                  | Context §5.1–5.2                                                                |
| Memory               | Write-back + consolidation / decay / archive (Postgres)                                                              | Memory §4.5                                                                     |
| Multi-agent          | Bounded autonomous loops + critique/revision (**không** thay Human)                                                  | Từng là non-goal                                                                |
| Benchmark            | Container runtime minimal-tools (bash + editor) + corpus gold labels                                                 | Spec 11 §5.1–5.2                                                                |
| Judge                | LLM-as-judge sau `LLMProvider` (rubric-scored, audit)                                                                | Spec 11 §5.1                                                                    |
| Queue (tuỳ chọn)     | Durable queue (Redis/SQS) thay in-process hand-off                                                                   | Orchestrator §6 — **không** đổi event contract                                  |

> **Bất biến xuyên suốt:** kiến trúc vẫn **modular monolith** (không microservices/K8s); Events vẫn qua `IEventBus` interface; dependency rules của domain/engines giữ nguyên. Các bổ sung sau chỉ **mở rộng infrastructure đằng sau seam**, không thay đổi hợp đồng.

---

## Lộ trình (đã hoàn tất)

Toàn bộ lộ trình 3 giai đoạn xây dựng đã hoàn tất, tagged `v0.4.0-harness` (`EXIT-WITH-CARRYFORWARD`, 8/9 exit criteria):

- **Core loop** (`v0.1.0-harness`): Task → Context → Agent → Artifact → Verification → Attention → Human Review → Decision → Evidence.
- **Calibrate & Close the Measurement Loop** (`v0.2.0-harness`): Evaluation Engine v0 (metrics + A/B harness), calibrate attention weights từ data `was_useful`, semantic search infra (shadow, sau Ranker seam), auto-approve sau flag + audit.
- **Review Control Plane** (`v0.4.0-harness`): MCP connectivity (GitHub/GitLab/Bitbucket/Jira qua một `@harness/mcp` client + `mcp.config.json`), toggle-gated write-back, review memory, LLM-as-judge with inter-judge agreement, và closed learning loop. Exit review: **8 của 9** tiêu chí đạt → `EXIT-WITH-CARRYFORWARD`; một caveat (hybrid ranking không phải default — Day-29 A/B HOLD) được carry-forward (CF-1/CF-2).

Lịch sử phân kỳ theo ngày (`docs/plan/`, phase-1/2/3) đã được gỡ bỏ; tổng kết exit ở `docs/retros/phase3-exit-review.md`.

---

## Những thứ cố tình không build

- Multi-agent orchestration phức tạp · RAG/vector DB · UI sophisticated · autonomous loops · microservices/K8s
- Auto-approve thật (r5 chỉ set flag) · SSO/auth thật (P0: hiện chỉ `X-Reviewer-Id` header)
- Semantic ranking, targeted/incremental verification (đã có seam trong interface)
- Code generation (AI viết code, commit, auto-merge) — đã retired trong `review-reorient`

---

## Trạng thái hiện tại so với lần review đầu

Các điểm "cần lưu ý" trước đây nay đã được giải quyết trong specs:

- ✅ **Schema domain objects** — đã định nghĩa đầy đủ (12 task states, artifact/change lifecycle, evidence model, event envelope)
- ✅ **Data storage strategy** — PostgreSQL 16 cho tất cả; conventions rõ ràng; evidence append-only
- ✅ **Error handling & fallback** — FailureClass (TRANSIENT/PERMANENT/RESOURCE), retry policy, escalation → AWAITING_HUMAN_INTERVENTION
- ✅ **Spec 9 (Memory/Evidence) & Spec 11 (Evaluation Engine)** — đã formalize từ các ghi chú "Phase sau" thành spec riêng: Evidence store append-only và Evaluation seam
- ✅ **Auth** — đã có `@harness/auth` (`requireRole` + session/OIDC identity); SSO đầy đủ vẫn là P0 ngoài phạm vi
- ✅ **MCP connectivity** — GitHub/GitLab/Bitbucket/Jira qua 1 config file
- ✅ **Write-back audit** — `writeback_log` + toggle chain (global + per-provider + per-decision)

**Kết luận:** Kiến trúc giữ nguyên hướng đi đúng (tập trung human attention bottleneck, evidence > confidence), nay đã đủ chi tiết để implement — với 11 phân hệ (state machine chặt chẽ, event model có audit trail), lộ trình rõ ràng, và kế hoạch từng bước đã được ghi trong lịch sử build.
