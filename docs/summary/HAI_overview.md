# Tổng quan Kiến trúc HAI Harness

## Tổng quan

**Human Attention Infrastructure (HAI) Harness** — nền tảng AI-native quản lý và tối ưu hóa "sự chú ý của con người" trong quy trình phát triển phần mềm: AI tạo ra công việc, Harness quan sát, xác minh, đánh giá, xếp ưu tiên và định tuyến tới đúng sự chú ý của con người.

---

## Vấn đề cốt lõi

> **AI tạo ra thay đổi phần mềm nhanh hơn con người có thể kiểm tra và xác thực. Sự chú ý của con người trở thành nút cổ chai.**

Kiến trúc biến "sự chú ý" thành tài nguyên có thể đo lường, định tuyến và tối ưu hóa.

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

| # | Phân hệ | Spec | Vai trò |
|---|---------|------|---------|
| 1 | **HAI Harness Architecture** | `docs/core/1_...` | Kiến trúc tổng thể, nguyên tắc, ranh giới module, lộ trình 3 phase |
| 2 | **Task/Work Orchestrator** | `docs/core/2_...` | State machine 12 trạng thái, dispatch, workflow, retry |
| 3 | **AI Agent Runtime** | `docs/core/3_...` | Thực thi agent (ReAct loop), ghi trajectory từng bước (append-only → fork/replay/resume ở Phase 2/3), tool sandbox |
| 4 | **Context Engine** | `docs/core/4_...` | Chọn lọc context relevant theo budget token, kiểm tra freshness; Phase 2/3: hybrid search + RRF + re-ranking |
| 5 | **Artifact/Change Tracker** | `docs/core/5_...` | Provenance: ai thay đổi gì, tại sao, evidence nào; snapshot content-addressed |
| 6 | **Attention Engine** 🔑 | `docs/core/6_...` | Tính Risk/Impact/Novelty/Complexity/Confidence → priority → routing |
| 7 | **Verification Engine** | `docs/core/7_...` | Xác minh độc lập với AI: compile, test, lint — kèm evidence |
| 8 | **Human Review Interface** | *(Phase 2 standalone)* | UI quyết định: APPROVE/REJECT + rationale (thiết kế trong `day-22..27`) |
| 9 | **Memory/Evidence System** | `docs/core/9_...` | Claim ≠ Evidence; evidence append-only, bất biến, có content hash; Phase 3: versioned memory + write-back (forget/update cross-checked) |
| 10 | **Observability/Governance** | *(Phase 2 standalone)* | Audit trail, metrics, policy enforcement |
| 11 | **Evaluation Engine** 🔁 | `docs/core/11_...` | Đo pipeline (routing precision/recall, attention efficiency), A/B harness, calibration; Phase 3: benchmark corpus (gold labels) + LLM-as-judge (rubric-scored) → đóng loop Learning |

Specs 1–7, 9, 11 đã có spec riêng. Spec 8 (Human Review Interface) và Spec 10 (Observability/Governance) được thiết kế chi tiết trong `docs/plan/day-22..27` và sẽ promoted thành spec standalone trong Phase 2.

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
- Phase 2/3: hybrid search (keyword + embeddings) hợp kết quả bằng Reciprocal Rank Fusion (RRF), rồi re-ranking dùng heuristic ngôn ngữ (dependency/recency/usage) để không "rửa trôi" match chính xác
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

## Lộ trình (3 Phase)

```text
PHASE 1 — Prove the Core Loop (30 ngày, hiện tại)
    Task → Context → Agent → Artifact → Verification
         → Attention → Human Review → Decision → Evidence

PHASE 2 — Calibrate & Close the Measurement Loop
    Evaluation Engine v0 (metrics + A/B harness — shadow, replay trajectory từ Spec 3)
    Calibrate Attention weights từ data `was_useful` thật
    Hybrid semantic ranking (keyword + embeddings + RRF + re-ranking, sau Ranker seam)
    Auto-approve (sau flag + sampling audit khi calibration đạt ngưỡng)
    Promote Human Review (8) & Observability (10) → spec riêng

PHASE 3 — Learn & Automate Under Guardrails
    Memory/Evidence system đầy đủ (retrieval, decision memory, expiration + versioned write-back)
    Targeted / incremental verification (dependency graph)
    Multi-agent orchestration + bounded autonomous loops
    Trajectory fork (so sánh model/prompt/context head-to-head) + resume (crash recovery)
    Benchmark corpus (gold labels versioned) + LLM-as-judge (rubric-scored, có audit trail)
    Đóng vòng: Evaluate → Calibrate → Deploy → Observe
```

- **Kế hoạch 30 ngày** (`docs/plan/`) là **Phase 1** — 4 tuần: Foundation → Execution core → Trust pipeline → Human loop + E2E, hard checkpoint ngày 7/14/21.
- **Milestone then chốt** (Spec 1 §24): `AI Change → Evidence → Risk → Human Attention → Decision → Learning`. Phase 1 chứng minh loop trừ bước *Learning* (vẫn thủ công); Phase 2 đo được pipeline; Phase 3 tự động đóng Learning.
- **Exit criteria**: Phase 1→2 khi loop demo được end-to-end + evidence queryable; Phase 2→3 khi có metrics precision/recall + calibration từ data thật.

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
- ⚠️ **Auth** — vẫn là Phase 2 (P0 trong backlog, xem `docs/plan/day-30.md`)

**Kết luận:** Kiến trúc giữ nguyên hướng đi đúng (tập trung human attention bottleneck, evidence > confidence), nay đã đủ chi tiết để implement — với 11 phân hệ (state machine chặt chẽ, event model có audit trail), lộ trình 3 phase rõ ràng, và kế hoạch 30 ngày (Phase 1) từng bước trong `docs/plan/`.
