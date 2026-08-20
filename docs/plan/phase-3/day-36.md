# Day 36 — Hardening: Multi-Agent Runaway Guards, Memory Growth, Hybrid Latency

| | |
|---|---|
| **Week** | 8 — Harden, document, exit |
| **Spec refs** | Spec 3 §14 (runaway/cost guards), Spec 9 §4.4–4.5 (decay/retention bounds), Spec 4 §5.1 (hybrid retrieval latency) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 35 (Week 7 checkpoint — closed loop demonstrable) |

---

## 1. Objectives

By end of day you will have:

1. **Multi-agent runaway hardening** — the Day 22 guards proven under adversarial workloads: nested loops, sub-agent fan-out, and a stubbornly unyielding primitive all terminate with sane budget use.
2. **Memory growth hardening** — the seven-kind memory store (Days 1–7) shown to stay bounded: consolidation, decay, archive, and `supersedes` chains capped so the store can't grow unboundedly in production.
3. **Hybrid latency hardening** — the Day 16–18 hybrid pipeline (BM25 + embeddings + RRF + re-rank + optional RAG Fusion) has measured, bounded latency (p95 targets), with RAG Fusion's cost guard proven under burst.
4. A **hardening report** capturing the bounded-by-construction guarantees and any residual risks.

This is the phase's strength day: make sure the things we built "bounded" actually are, before the E2E load profile (Day 37) hammers them.

---

## 2. Design Decisions

### 2.1 Runaway: treat budgets as *system* property, not per-call

- Sub-agents inherit their parent's budget ceiling (a MapReduce spawning N Coder sub-agents must not be 5× the parent's token allowance).
- A fan-out primitive (MapReduce/Ensemble) has a **fan-out cap** and a **cumulative budget**; exceeding the parent budget escalates, even if each sub-agent individually stayed within limits.
- A primitive that returns "stuck but not erroring" repeatedly → no-progress escalation *across* the fan-out, not per leaf.

### 2.2 Memory growth: bounded store

- Decay (`0.99^days`) + archive (90d) + retain policy already exist (Days 6–7). Hardening adds:
  - `supersedes` chain **length cap** (e.g. 8) — beyond it, older superseded entries are hard-archived and the chain keeps only the newest `cap` links.
  - **Size budgets** per kind (row count + byte size) with page-out to the cold tier at `0.8 × cap`.
  - `retrievedCount`/`lastRetrievedAt` based eviction so hot-but-bounded wins over unbounded-cold.
- Prove growth is sublinear over simulated weeks (a growth test, not a promise).

### 2.3 Hybrid latency: p95 budget

- Targets (config, CI-asserted): lexical+semantic parallel fetch + RRF + re-rank ≤ p95 250ms (cold) / 150ms (warm); RAG Fusion opt-in keeps the total within a `MAX_RAG_FUSION_QUERIES=3` cost cap and a wall-clock ceiling.
- Re-rankers must be O(pinned results), not O(all candidates) — protect hot path.
- Latency is measured with the real (not mock) retrieval path against the seeded corpus, so the number is honest.

### 2.4 Hardening is measurement + bound, not "more tuning"

No new features. Each guardianship is *already* there in some form; today proves the bound and closes the gaps (fan-out budget inheritance, supersedes cap, hot-path p95). Results go into the hardening report.

---

## 3. Tasks

### 3.1 Runaway hardening (180 min)

- [ ] Fan-out budget inheritance + cumulative ceilings for MapReduce/Ensemble (§2.1).
- [ ] Tests: N sub-agents where N×per-leaf-budget > parent → escalates; stuck-fan-out → no-progress escalation.
- [ ] Adversarial MockLLM suite: nested loops, refusing primitive, exploding fan-out.

### 3.2 Memory growth hardening (150 min)

- [ ] `supersedes` chain-length cap + kind-level size budgets + cold-tier page-out (§2.2).
- [ ] Simulated multi-week growth test: store size stays bounded; hot entries retained, decayed entries archived.

### 3.3 Hybrid latency hardening (150 min)

- [ ] Instrument the real retrieval path; assert p95 targets (§2.3).
- [ ] Re-rank complexity bound check; RAG Fusion cost + wall-clock cap proven under burst (concurrent queries).

### 3.4 Hardening report (60 min)

- [ ] `docs/reports/phase3-hardening.md` — bounded-by-construction claims with measured numbers + residual risks.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/multi-agent/src/fanout-budget.ts` | Fan-out budget inheritance |
| `packages/context-engine/src/memory-bounds.ts` | Supersedes cap + tier page-out |
| `packages/context-engine/src/latency.ts` | p95 instrumentation |
| `packages/.../__tests__/*.test.ts` (adversarial/growth/latency) | Hardening tests |
| `docs/reports/phase3-hardening.md` | Hardening report |

---

## 5. Acceptance Criteria

- [ ] Runaway: nested/fan-out/stuck workloads all terminate within budget (cumulative ceilings enforced).
- [ ] Memory: simulated multi-week growth stays bounded; `supersedes` chains capped; cold tier pages out at cap.
- [ ] Hybrid: p95 ≤ targets (cold 250ms / warm 150ms); RAG Fusion cost + wall-clock capped under burst.
- [ ] Bounds are *measured* (real paths, adversarial workloads) and recorded in `phase3-hardening.md`.
- [ ] No new features introduced; existing tests still green.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **Budgets that don't compose are budgets you don't have.** A MapReduce whose leaves each stay under budget but whose sum explodes is a runaway wearing a compliance costume. Cumulative + inherited ceilings are the fix.
- **Memory "bounded" must survive simulated time.** A store that's fine on day 1 and unbounded on day 90 isn't bounded. The multi-week growth test catches what a unit test can't.
- **`supersedes` chains grow forever if nothing caps them.** Versioned write-back is good, but an unbounded append-only history is the memory equivalent of a runaway. Cap the chain; archive the tail.
- **Latency numbers only count on the real path.** A mock-LLM p95 of 3ms is fiction. Measure the seeded real retrieval path, under actual concurrence, and record it honestly.
- **RAG Fusion is the latency/cost trap.** It's opt-in for a reason. Its burst behavior must be capped or it turns a fine default into a p99 catastrophe under load.
- **Tomorrow (Day 37):** E2E full system under Phase-3 infra + load profile.

---

*Prev: [Day 35 — Week 7 Checkpoint: Closed Loop Demonstrable Autonomously](day-35.md) | Next: [Day 37 — E2E Full System Under Phase-3 Infrastructure + Load Profile](day-37.md)*
