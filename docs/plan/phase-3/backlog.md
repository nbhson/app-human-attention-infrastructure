# Phase 3 Backlog

*Day-30 deliverable (Phase-2 README §1 out-of-scope items + the Day-30 exit
review's carried caveats). Each item names the seam it plugs into and the gate
it must re-run — an acceptance shape, not a "we should probably". Phase 2's rule
("shadow-then-default", "AI never becomes authority", "calibration gates
auto-approve") carries forward unchanged; these items only become Phase-3 day
files when the seam exists and the gate is specified.*

---

## From Phase 2's "explicitly out of scope" list (§1.1)

### 1. Hybrid context ranking as the default

- **Where it lands:** Phase 3 Week 4 (days 16–20, "BM25 + embeddings + RRF +
  re-rank is the default ranker").
- **Seam it plugs into:** the `Ranker` / `Retriever` seam already installed in
  `context-engine` (`KeywordDependencyRanker` default; `SemanticRanker` +
  `SemanticRetriever` behind `resolveWithShadow`), plus `Embedder`
  (`StubEmbedder` / `OpenAICompatibleEmbedder`, day-16).
- **Gate it must re-run:** the Day-29 A/B — but on **live outcome data**, not
  replay. The dry-run's honest call was *"promote semantic ranking to a real
  A/B"* (rankings reversed at `tau=-1`, but replayed outcome was a toss-up). The
  cutover must show arm B lowering `rework_rate` / `human_minutes_per_accept`
  **without** losing `context_acceptance_rate`, at top-k pressure (fewer than
  the candidate count), before `rank_method` flips off
  `phase1-keyword-dependency`. Then `semanticShadowEnabled` default flips ON, and
  the shadow-negative test is retired — deliberately, by winning the harness, not
  by being newer.

### 2. Full Memory / Evidence subsystem

- **Where it lands:** Phase 3 Weeks 1–2 (days 1–10, "Memory: store & retrieve"
  then "lifecycle + trajectory").
- **Seam it plugs into:** the `EvidenceStore` already resolved by
  `VerificationEngine` (day-17), versioned write-back on top of the append-only
  `event_log`, and the `ContextEngine` collector (`resolveContext`) as the
  read-back surface.
- **Gate it must re-run:** the Week-1/Week-2 Phase-3 checkpoints — a memory
  written from real evidence reads back with relevance scoring above the
  declared floor (`0.6·sim + 0.2·recency + 0.2·access`), and
  consolidation/decay/archive is validated against a real decision log, not a
  script. The `supercedes` log must `git log`-style roll back.

### 3. Targeted / incremental verification

- **Where it lands:** Phase 3 Week 3 (days 11–15, "dependency graph → targeted
  verify").
- **Seam it plugs into:** the `VERIFY` step handler's `{CompileCheck, TestCheck}`
  (verification-engine, days 15–16) + `EvidenceStore`; the tree-sitter code
  index is a new leaf (`code-index`) feeding a dependency graph read by the
  impact-analysis that selects affected tests.
- **Gate it must re-run:** the Phase-3 Week-3 checkpoint — targeted verify
  demonstrably reduces **p95 verify latency** against a full-suite baseline,
  **with no correctness regression** on the golden suite. "Faster but wrong" is
  a failure, not a win.

### 4. Multi-agent orchestration / bounded autonomous loops

- **Where it lands:** Phase 3 Week 5 (days 21–25, "Multi-agent, bounded").
- **Seam it plugs into:** `WorkflowRunner` (`runLinearWorkflow`, day-09) as the
  orchestration point, `LLMProvider` (`LoggingLLMProvider`, day-11), and
  `AgentRunner`'s `maxSteps` + `tokenLimit` budget plumbing (day-12).
- **Gate it must re-run:** the Phase-3 Week-5 checkpoint — every loop stays
  within a hard iteration + token ceiling, and **every human-facing decision
  still routes through the human APPROVE/REJECT gate** (or the already-gated,
  sampling-audited `AUTO_APPROVABLE`). A runaway is a failure mode to *test for*,
  never a feature to accept (Phase-3 README §8.3).

### 5. LLM-as-judge + benchmark corpus

- **Where it lands:** Phase 3 Week 6 (days 26–30, "Benchmark + judge").
- **Seam it plugs into:** `LLMProvider` (`AnthropicProvider` / `MockLLM`, day-11)
  as the judge's model seam, plus a new `benchmark` package (minimal container
  harness, bash + editor tools) for the corpus runtime; the judge's rubric scores
  land as quality signals that the closed loop later feeds to calibration.
- **Gate it must re-run:** the Phase-3 Week-6 checkpoint — judge calibration is
  demonstrated **with inter-judge agreement** (human vs LLM on a held-out sample),
  and the corpus runs end-to-end. A judge with unknown agreement is a generator,
  not a gauge; the audit trail for each rubric score must exist.

---

## From the Day-30 exit review (carried caveats — new backlog items)

### 6. Calibration data accumulation → re-fit to a verdict

- **Origin:** Finding 2 in `phase2-metrics.md` — the Day-12 fit did not beat the
  placeholder (`log_loss` 0.316 vs **0.262**), so `StaticWeightsAdapter` stayed
  and the improvement half of §7.2 is **△**.
- **Seam it plugs into:** `WeightsProvider` (day-12) — currently a `StaticWeightsAdapter`
  returning the Phase-1 placeholder.
- **Gate it must re-run:** accumulate real `was_useful` + assessment + outcome
  rows beyond the N=4 demo window, then `eval:fit` must print
  `improvement: true` (beating 0.262 on held-out) **and** the inflation-monitor
  must stay under the Spec 6 §4.1 ceiling — *only then* does `WeightsProvider`
  flip off the placeholder. Until then the placeholder is the correct, measured
  default. Tracked against Phase 3's closed-loop calibration (days 31–35).

### 7. Coverage tooling

- **Origin:** Finding 4 in `phase2-metrics.md` — test volume (695/132) and the
  green gate are established, but a line/branch coverage threshold has **never
  been recorded** in any phase, so the Spec 11 quality claim is count-strong and
  coverage-blind.
- **Seam it plugs into:** the Vitest workspace config (a `@vitest/coverage-v8`
  entry per package), plus the Phase-3 numbers-checkpoint habit (§4.2 of
  `phase2-metrics.md`).
- **Gate it must re-run:** before Phase 3's first numbers checkpoint, produce a
  real coverage report and record the number; then a coverage threshold in the
  CI gate (not a wall of "≥70%" asserted out of nowhere — measure first, set the
  bar second).

---

## Not backlog (explicitly *not* promoted)

- **Microservices / K8s** — Phase-3 README §1 restates it as a non-goal; the
  system stays a modular monolith.
- **Autonomous APPROVE/REJECT without a human** — the human gate is untouched;
  `AUTO_APPROVABLE` remains the only auto-path and stays sampling-audited.
- **GraphRAG / knowledge-graph over the codebase** before the SQL dependency
  graph is proven — Phase 3 builds the SQL graph first; RAG Fusion stays behind
  `Retriever`, not the graph.

---

*The gate for every "already seamed" item is the same discipline Phase 2 used:
the thing earns its default by winning a measured comparison (`eval:ab-report`,
`eval:fit`, or a checkpoint delta), never by virtue of being newer or now
existing.*