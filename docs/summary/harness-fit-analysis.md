# Phân tích độ phù hợp — AI-coding-skills-framework/harness → HAI Harness

**Đối chiếu:** `https://github.com/nbhson/knowledge-ai/tree/main/AI-coding-skills-framework/harness` (11 phần chuyên đề `01–11` + 4 file DeepSeek Harness chuyên biệt) ↔ kiến trúc **HAI (Human Attention Infrastructure)**.

**Mục đích:** Xác định kỹ thuật nào của framework nguồn **phù hợp** với HAI, phù hợp ở **đâu** (spec nào), ở **phase nào**, kỹ thuật nào **đã hấp thụ rồi**, và kỹ thuật nào **không phù hợp** — tránh "nhặt hết về" một cách mù quáng. Nguyên tắc lọc là duy nhất: *kỹ thuật đó có giúp giảm Human Attention cần thiết để chấp nhận thay đổi một cách an toàn không?*

---

## 0. Chú giải bản đồ

| Verdict | Ý nghĩa | Hành động |
|---------|---------|-----------|
| **Đã hấp thụ** | Spec hiện tại đã mô tả kỹ thuật này (thường dẫn "adopted from the reference skills framework") | Không sửa thêm |
| **Phù hợp — bổ sung** | Kỹ thuật có giá trị, chưa có trong spec | Đã/đang bổ sung vào spec cụ thể + phase |
| **Tham khảo** | Hữu ích về ý tưởng nhưng không cần đưa thành contract | Ghi nhận, không bắt buộc |
| **Không phù hợp** | Mâu thuẫn với nguyên tắc HAI hoặc lệch mục tiêu | Ghi rõ lý do loại |

---

## 1. Bản đồ tổng quan

| # | Kỹ thuật nguồn (harness) | HAI subsystem | Phase | Verdict |
|---|--------------------------|---------------|-------|---------|
| 01 | retrieve-memory-knowledge (embedding/chunking/ANN/RAG/hybrid/BM25+RRF/GraphRAG/MemGPT) | Context (4), Memory (9) | 3 | Đã hấp thụ (Context §5.1) + bổ sung (Memory) |
| 02 | build-context (budget, lost-in-middle, 5-level, routing, RAG-Fusion, cache, validator) | Context (4) | 2–3 | Bổ sung (§5.2) |
| 03 | update-memory-store (write-back, consolidate, VersionedMemory, Trajectory) | Memory (9), Agent (3) | 3 | Đã hấp thụ (§4.4, §6.1) + bổ sung (§4.5) |
| 04 | plan-decompose-task (Plan-and-Solve/ToT/ReWOO/HTN/reflective) | Orchestrator (2) | 3 | Bổ sung (Decomposer) |
| 05 | prompt-builder (template, few-shot, guardrail, versioning) | Agent (3), Evaluation (11) | 2–3 | Tham khảo (versioning + guardrail) |
| 06 | decide-tools-mcp (tool registry, RBAC, rate-limit, Code Mode SDK) | Agent (3), Verification (7) | 2–3 | Bổ sung (RBAC/rate-limit/sandbox) |
| 07 | workflow (pipeline, saga, circuit-breaker, Cordis plugin) | Orchestrator (2) | 2 | Bổ sung (saga + circuit-breaker) |
| 08 | task (classification, DAG, lifecycle, token budget) | Orchestrator (2) | — | Đã bao phủ (Spec 2) |
| 09 | multi-agent (MapReduce/Debate/Critique/Ensemble) | *(Phase 3)* | 3 | Bổ sung ghi chú (bounded loops) |
| 10 | automation (CI/CD, self-healing, guardrails, observability) | Observability (10) | 2 | Tham khảo → spec 10 tương lai |
| 11 | evaluation (rubric, metrics, SWE-bench, LLM-judge, benchmark harness) | Evaluation (11) | 3 | Đã hấp thụ (§5, §5.1) + bổ sung (benchmark runtime) |

**4 mẫu DeepSeek Harness** (xem §4): `Agent = Model + Harness` · Micro-kernel "Everything is a Plugin" · 4 Runtime Modes · Session Event Stream (Replay/Fork/Resume) · Code Mode SDK · Minimal Benchmark Harness.

---

## 2. Chi tiết theo từng phần

### 2.1 `01-retrieve-memory-knowledge`

**Đã hấp thụ:** Context Engine §5.1 — hybrid retrieval (BM25 lexical + embedding semantic), RRF `k=60`, re-ranking (cross-encoder/LLM-judge audited). Đây chính là bản đồ "hybrid search + RRF + re-ranking" được framework mô tả.

**Phù hợp — bổ sung (Phase 3):**
- **Phân loại bộ nhớ** (sensory / working / short-term / long-term; MemGPT tiered-memory) → làm giàu Memory Model (Spec 9) §4.1: map sang *Task / Session / Project / Decision / Failure / Review Memory* và thêm khái niệm "bậc nhớ" (tier): hot context vs cold archive.
- **Memory patterns** (Buffer/Window/Summary/Entity/Semantic) → bổ sung vào Memory §4.5 như các chiến lược nén truy hồi, không phải 1 vector-DB monololithic.
- **Knowledge Graph triplet + GraphRAG** → ghi nhận là lựa chọn Phase 3 *sau khi* đã có dependency graph (Spec 5/7), không build trước.

**Không phù hợp (bây giờ):** tối ưu ANN index (HNSW), chunking, tuning vector-DB — HAI là PostgreSQL-only trong Phase 1, không có vector store; chỉ có nghĩa khi Phase 3 bật semantic retrieval.

### 2.2 `02-build-context`

**Phù hợp — bổ sung (Phase 2–3):** (đã ghi vào Context Engine §5.2)
- **5-level hierarchical context** + luật evict "không bao giờ evict system/target" → khớp trực tiếp với pipeline delivery 4 lớp của Context §3.
- **Lost-in-the-middle** → lý do định lượng cho việc re-rank top-N thay vì dump đầy đủ.
- **Context Cache** (key = content-hash, TTL, invalidate khi hash đổi) → hiện thực hoá mục "context caching" Phase 2 của Context §10.
- **Context Validator** (token/relevance/freshness/structure) → bổ sung cổng kiểm tra trước khi deliver.
- **RAG Fusion (multi-query + RRF)** → nâng cấp Phase 3 đằng sau seam `Retriever`.

**Tham khảo:** 4 chiến lược tiết kiệm token (60–80%) là tối ưu chi phí cho agent; liên quan gián tiếp (giảm latency/chi phí, không trực tiếp giảm attention). Ghi nhận, không đưa vào contract.

**Không phù hợp:** `MultiTurnContextManager` (quản hội thoại nhiều lượt) — HAI là agent-run có trajectory, không phải chat session.

### 2.3 `03-update-memory-store`

**Đã hấp thụ:** Memory §4.4 — write-back closed loop (evidence → distill → rank → outcome → calibrate), versioned append (`supersedes`), outcome-driven promotion. Agent §6.1 — Trajectory Fork/Replay/Resume (từ DeepSeek Trajectory engine).

**Phù hợp — bổ sung (Phase 3):** (đã ghi vào Memory §4.5)
- **Consolidation pipeline** (dedup ngưỡng 0.85, conflict strategy temporal/confidence, decay `0.99^days`, archive 90 ngày) → cụ thể hoá §4.3 lifecycle.
- **Relevance scoring** (`0.6·similarity + 0.2·recency + access_freq`) → tín hiệu xếp hạng Memory cho Context.
- **VersionedMemory Git-like** (log/rollback) → §4.4 đã có versioned append; bổ sung thao tác rollback/log cho khả năng audit.

### 2.4 `04-plan-decompose-task`

**Phù hợp — bổ sung (Phase 3):** Orchestrator §10 "AI-Driven Decomposition" hiện chỉ một dòng. Bổ sung cho **Planner/Decomposer** của Orchestrator:
- **3-level hierarchical planning** (goal → subtask → atomic task) cho bước phân rã.
- **Plan-and-Solve / ReWOO** làm chiến lược sinh plan; **dynamic replanning** khi REWORK/FAILED.
- **10 Commandments** + **HTN/Self-Reflective planning** làm guardrail cho kế hoạch sinh ra (plan phải đúng, không over-engineer).

### 2.5 `05-prompt-builder`

**Tham khảo (2–3):** Prompt versioning → HAI đã có `prompt_hash` trong Trajectory §6.1 và A/B harness (Spec 11). Prompt guardrail + prompt-leak defense → bổ sung nhẹ vào Agent §14 (security). Không phải trục chính của HAI.

### 2.6 `06-decide-tools-mcp`

**Phù hợp — bổ sung (Phase 2–3):** (đã ghi vào Agent §14)
- **RBAC permission tiers** (public / standard / elevated / admin) → làm giàu `allowed_tools` list hiện tại.
- **Rate limiting** (sliding window) per tool → guardrail chi phí/an toàn.
- **Code Mode SDK** (vm sandbox + batched tools) → mẫu sandbox cho Agent §14 và Verification §5.5.

### 2.7 `07-workflow`

**Phù hợp — bổ sung (Phase 2):** (đã ghi vào Orchestrator §7)
- **Saga / compensation** → REWORK phải có bước compensate (rollback artifact) rõ ràng.
- **Circuit breaker** → ngắt khi LLM/tool provider liên tục lỗi, tránh domino failure.
- 6 nguyên tắc thiết kế workflow (idempotency / observability / separation / progressive-disclosure / fail-fast / state-externalization) → chú thích vào Orchestrator principles.

**Tham khảo:** DeepSeek Cordis "Everything is a Plugin" + Context DI → trùng với modular-monolith + `packages/di` + interface-based integration của HAI. Ghi nhận là nguồn cảm hứng kiến trúc, không cần thay node.

### 2.8 `08-task`

**Đã bao phủ:** classification/lifecycle/DAG/scheduling đều đã có trong Orchestrator Spec 2 (12 states, 4 workflow types, topological scheduler). Không bổ sung gì thêm — tránh trùng lặp.

### 2.9 `09-multi-agent`

**Không phù hợp Phase 1** (đã là non-goal). **Phù hợp Phase 3 (ghi chú):**
- Role taxonomy (Coder/Reviewer/Tester/Orchestrator) + MapReduce/Critique-Revision/Debate/Ensemble → định hình "bounded autonomous loops".
- **Guardrail HAI:** Critique-Revision (AI review AI) *bổ trợ* Verification/Attention nhưng **không bao giờ thay thế** Human Decision — khớp nguyên tắc "AI là execution, không phải authority".

### 2.10 `10-automation`

**Tham khảo → spec 10 tương lai:** Automation (CI/CD, self-healing, guardrails, observability, deployment guardrails) là nguồn trực tiếp cho **Observability/Governance (10)** — subsystem chưa có spec standalone (được promote ở Phase 2, hiện thiết kế trong `day-22..27`). KHÔNG viết spec 10 bây giờ (đúng theo plan); ghi lại map để dùng khi promote.

### 2.11 `11-evaluation`

**Đã hấp thụ:** Evaluation §5 (A/B shadow harness), §5.1 (benchmark corpus gold labels + LLM-as-judge rubric-scored audited). Trùng khớp chặt với framework.

**Phù hợp — bổ sung (Phase 3):** (đã ghi vào Evaluation §5.2)
- **Minimal Benchmark Harness** (2 tool: bash + file-editor, container isolation, full TrajectoryEvent, tích hợp SWE-bench) → mẫu thực thi benchmark corpus, tái dùng trajectory + sandbox của HAI.
- **Rubric dimensions** + external benchmark (SWE-bench/LiveCodeBench) làm tài liệu tham khảo gold-standard.

---

## 3. 4 mẫu DeepSeek Harness chuyên biệt

| Mẫu | Bản đồ sang HAI | Verdict |
|-----|-----------------|---------|
| **Agent = Model + Harness** | Đúng tinh thần "AI là execution component; Harness là control plane" (Architecture §4.2) | Đã hấp thụ (về tư duy) |
| **Micro-kernel / Everything is a Plugin (Cordis + Context DI)** | Modular monolith + `packages/di` + interface-based integration | Tham khảo (kiến trúc) |
| **4 Runtime Modes (Standard/Code/Minimal/Creator)** | Code Mode → Agent sandbox + verification sandbox; Minimal → benchmark harness | Bổ sung (Agent §14, Verification §5.5) |
| **Session Event Stream / Trajectory (Replay/Fork/Resume/Search)** | Agent Runtime §6.1 — append-only, replayable, forked_from | Đã hấp thụ |
| **Code Mode SDK (vm sandbox, batched tools)** | Sandbox isolation cho Agent §14 + Verification §5.5 | Bổ sung |
| **Minimal Benchmark Harness (2 tools + container)** | Evaluation §5.1 — benchmark corpus runtime | Bổ sung |

---

## 4. Không phù hợp — và lý do

| Kỹ thuật | Lý do loại (bây giờ) |
|----------|----------------------|
| Vector-DB / ANN index / chunking (01) | Postgres-only Phase 1; chỉ có nghĩa khi Phase 3 bật semantic |
| MultiTurnContextManager (02) | HAI là trajectory, không phải chat session |
| Multi-agent Debate/Ensemble (09) trước Phase 3 | Mâu thuẫn non-goal Phase 1; và AI-check-AI không thay được Human |
| DevOps CI/CD đầy đủ, self-healing tự động (10) trước Phase 2 | Thuộc spec 10, chưa promote |

---

## 5. Những thay đổi đã thực hiện trong `docs/`

| File | Thay đổi |
|------|----------|
| `core/4_Context_Engine_v0.2.md` | + §5.2 Hierarchical context, lost-in-the-middle, cache, validator, RAG-Fusion |
| `core/9_Memory_Evidence_System_v0.2.md` | + §4.5 Consolidation/decay/archive, relevance scoring, retrieval patterns |
| `core/3_AI_Agent_Runtime_v0.2.md` | + §14 RBAC tiers, tool rate-limit, Code-Mode sandbox (mở rộng) |
| `core/7_Verification_Engine_v0.2.md` | + §5.5 Code Mode / Benchmark container isolation tham chiếu |
| `core/2_Task_Work_Orchestrator_v0.2.md` | + §7 Saga/compensation + circuit breaker; Phase 3 Decomposer planning |
| `core/11_Evaluation_Engine_v0.2.md` | + §5.2 Minimal Benchmark Harness runtime + rubric dimensions |

Các bổ sung được đặt đúng phase (không kéo kỹ thuật Phase 3 xuống Phase 1), giữ nguyên quy ước `Status / Dependency / Purpose`, và không phá vỡ nguyên tắc dependency (engines không import nhau).