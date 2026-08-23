# Phase 3 Backlog

*Day-30 deliverable (Phase-2 README §1 out-of-scope items + the Day-30 exit
review's carried caveats). Each item names the seam it plugs into and the gate
it must re-run — an acceptance shape, not a "we should probably". Phase 2's
rules carry forward unchanged: **shadow-then-default**, **calibration gates
auto-approve**, and **the AI reviewer stays read-only** (write-back is
commentary/status, never a code change). These items become Phase-3 day files
only when the seam exists and the gate is specified.*

> **`review-reorient` (v0.6) — re-anchored.** The code-generation path was
> retired, so the items below are re-anchored to the review slice. "Memory" is
> now **review memory** (past reviews/findings/decisions), not code-generation
> trajectory state; there is no multi-agent/`WorkflowRunner`/`AgentRunner`
> orchestration item — that product path is gone; write-back replaces the old
> "approach" of auto-commit/auto-merge.

---

> **Day-40 exit review — carried forward.** Phase 3 closed with
> **EXIT-WITH-CARRYFORWARD** (8 of 9 criteria). Items **1** (hybrid default) and
> **6** (fitted-weight re-fit) are the two open carries — both emerged from
> `docs/retros/phase3-exit-review.md` (§4, CF-1 / CF-2) and their gates below are
> unchanged: each earns its default by winning a measured live-data comparison, not
> by being newer. The AI reviewer stays read-only throughout.

---

## From Phase 2's "explicitly out of scope" list (§1.1)

### 1. Hybrid context ranking as the default — *Day-40 carry CF-1 (still open)*

- **Where it lands:** Phase 3 Week 6 (days 26–30) — BM25 + embeddings + RRF +
  re-rank becomes the default ranker, then hybrid cutover + A/B vs the shadow
  baseline.
- **Seam it plugs into:** the `Ranker` / `Retriever` seam already installed in
  `context-engine` (`KeywordDependencyRanker` default; `SemanticRanker` +
  `SemanticRetriever` behind `resolveWithShadow`), plus `Embedder`
  (`StubEmbedder` / `OpenAICompatibleEmbedder`, Phase-2 day-16).
- **Gate it must re-run:** the Day-29 A/B — but on **live outcome data**, not
  replay. The Phase-2 dry-run's honest call was *"promote semantic ranking to a
  real A/B"* (`rank_correlation = [-1.0, -1.0]`, guardrail HELD). The cutover
  must show arm B lowering review-inefficiency/acceptance cost **without**
  losing `context_acceptance_rate`, at top-k pressure, before `rank_method`
  flips off the keyword default. Then `semanticShadowEnabled` defaults ON and the
  shadow-negative test is retired — by winning the harness, not by being newer.

### 2. Review-memory subsystem

- **Where it lands:** Phase 3 Week 4 (days 16–20) — review-memory tiers written
  from evidence + read back with relevance scoring, then lifecycle
  (consolidation/decay/archive).
- **Seam it plugs into:** the `EvidenceStore` already resolved by
  `VerificationEngine` (Phase-1 day-17), versioned write-back on top of the
  append-only `event_log`, and the `ContextEngine` collector as the read-back
  surface.
- **Gate it must re-run:** the Week-4 checkpoint — a review memory distilled
  from real evidence reads back with relevance scoring above the declared floor,
  and consolidation/decay/archive is validated against a real decision log, not
  a script. The `supersedes` chain must `git log`-style roll back. Memory kinds
  are review-shaped (`REVIEW` / `FINDING` / `DECISION` / `PROJECT`) — no
  code-generation trajectory tiers.

### 3. Targeted / incremental verification

- **Where it lands:** Phase 3 Week 3 (day 14) — dependency-graph-driven test
  selection.
- **Seam it plugs into:** the verification `{CompileCheck, TestCheck}` handlers
  (Phase-1 days 15–16) + `EvidenceStore`; the tree-sitter `code-index` builds a
  dependency graph (day 11–13) read by the impact-analysis that selects affected
  tests.
- **Gate it must re-run:** the Week-3 checkpoint — targeted verify demonstrably
  reduces **p95 verify latency** against the full-suite baseline, **with no
  correctness regression** on the golden suite. "Faster but wrong" is a failure,
  not a win (the harness reports, it does not fix).

### 4. Write-back breadth (commentary/status only)

- **Where it lands:** Phase 3 Week 2 (days 6–10) — `WriteBackService`
  (comment/label/status → PR/MR, comment/transition → Jira) plus idempotency and
  a toggle.
- **Seam it plugs into:** the `GitProvider` / `TicketProvider` seams
  (`postComment`, `setStatus`, `addLabel`; Jira transition) — realized through
  the connected **MCP tools** (`@harness/mcp` + `mcp.config.json`), with
  `writeback_log` audit.
- **Gate it must re-run:** the Week-2 checkpoint — approve with toggle ON lands
  exactly one comment (idempotent, no duplicate on retry); toggle OFF writes
  nothing external. Because the AI never authors code, write-back is the only
  external side effect and is therefore the one place a stray token could leak a
  write — token redaction + `writeback_log` audit are the guard.

### 5. LLM-as-judge + review-quality corpus

- **Where it lands:** Phase 3 Week 5 (days 21–25) + Week 8 (day 39) —
  rubric-scored judge over review reports + a gold-labeled review corpus.
- **Seam it plugs into:** `LLMProvider` as the judge's model seam, plus a new
  `judge` package (rubric: severity/routing agreement) and a `benchmark` package
  for the corpus of versioned gold review examples. Judge scores become quality
  signals the closed loop feeds to calibration.
- **Gate it must re-run:** the Week-5 checkpoint — judge calibration is
  demonstrated **with inter-judge agreement** (human vs LLM on a held-out
  sample), and the corpus runs end-to-end. A judge with unknown agreement is a
  generator, not a gauge; the audit trail for each rubric score must exist.

---

## From the Day-30 exit review (carried caveats — new backlog items)

### 6. Calibration data accumulation → re-fit to a verdict — *Day-40 carry CF-2 (still open)*

- **Origin:** the Phase-2 fit did not beat the placeholder (`log_loss` 0.316 vs
  **0.262**), so the fitted weights were **held back** and
  `StaticWeightsAdapter` stayed the default.
- **Seam it plugs into:** `WeightsProvider` (Phase-2 day-12) — currently a
  `StaticWeightsAdapter` returning the Phase-1 placeholder.
- **Gate it must re-run:** accumulate real `was_useful` + assessment + outcome
  rows beyond the N=4 demo window, then `eval:fit` must print
  `improvement: true` (beating 0.262 on held-out) **and** the inflation-monitor
  must stay under the Spec 6 §4.1 ceiling — *only then* does `WeightsProvider`
  flip off the placeholder. Until then the placeholder is the correct, measured
  default. Tracked against Phase 3's closed-loop calibration (days 31–35).

### 7. Coverage tooling

- **Origin:** test volume and the green gate are established, but a
  line/branch coverage threshold has **never been recorded**, so the quality
  claim is count-strong and coverage-blind.
- **Seam it plugs into:** the Vitest workspace config (a `@vitest/coverage-v8`
  entry per package), plus the Phase-3 numbers-checkpoint habit.
- **Gate it must re-run:** before Phase 3's first numbers checkpoint, produce a
  real coverage report and record the number; then set a coverage threshold in
  the CI gate (measure first, set the bar second — not a "≥70%" asserted out of
  nowhere).

---

## Not backlog (explicitly *not* promoted)

- **Microservices / K8s** — the system stays a modular monolith.
- **AI writing or committing code** — the reviewer is permanently read-only;
  write-back is commentary/status, never a code change.
- **Autonomous APPROVE/REJECT without a human** — the human gate is untouched;
  `AUTO_APPROVABLE` remains the only auto-path and stays sampling-audited.
- **GraphRAG / knowledge-graph over the codebase** before the SQL dependency
  graph is proven — Phase 3 builds the SQL graph first; RAG Fusion stays behind
  `Retriever`.

---

*The gate for every "already seamed" item is the same discipline Phase 2 used:
the thing earns its default by winning a measured comparison (`eval:ab-report`,
`eval:fit`, or a checkpoint delta), never by virtue of being newer or now
existing.*