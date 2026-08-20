# Day 25 — Week 5 Checkpoint: Multi-agent Demo + Guardrail Proofs

| | |
|---|---|
| **Week** | 5 — Multi-agent, bounded |
| **Spec refs** | Spec 3 §4/§14 (roles, bounded execution), Spec 2 §10 (Decomposer), Architecture §4.2 (AI not authority) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 24 (Decomposer + planning guardrails) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A **multi-agent demo** — a bounded MapReduce + Critique-Revision + Decomposition run end-to-end on a real-ish task, narrated, with every loop metered.
2. **Guardrail proofs**: (a) runaway halt, (b) no-progress halt, (c) role-bypass rejection, (d) AI-review-never-decides — each demonstrated live, not asserted in a comment.
3. A **Week 5 retrospective note**.

**Do not proceed to Day 26 until every acceptance criterion in §5 is green.**

---

## 2. What Week 5 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Multi-agent primitives (MapReduce / Critique-Revision / Ensemble) | `@harness/multi-agent` | ✅ Day 21 |
| Bounded autonomous loops + runaway/no-progress guards | `@harness/multi-agent` | ✅ Day 22 |
| Role taxonomy (Coder/Reviewer/Tester/Orchestrator) | `@harness/multi-agent` | ✅ Day 23 |
| Decomposer (3-level, ReWOO, dynamic replan) | `@harness/multi-agent` | ✅ Day 24 |

---

## 3. Tasks

### 3.1 Multi-agent demo script (120 min)

- [ ] `scripts/demo-week5.ts` (deterministic, MockLLM-driven):
  1. Decompose a goal into atomic tasks with guardrails passing.
  2. Run a bounded `MapReduce` over a sub-task; show per-iteration iteration/token/wall metering.
  3. Run a `CritiqueRevision`; show the critique surfaced as advisory (not a decision) in the review queue.
  4. End at the human APPROVE/REJECT gate — narrate that the loop *always* lands there.

### 3.2 Guardrail proofs (150 min)

- [ ] `apps/api/src/__tests__/week5-guardrails.test.ts` with four live proofs:
  - **Runaway**: forever-looper halts at the ceiling and escalates.
  - **No-progress**: repeating tool call escalates early.
  - **Role bypass**: a REVIEWER with `write_file` is rejected pre-dispatch.
  - **AI review never decides**: a REVIEWER output containing a verdict is rejected; `review.decision_submitted.triggered_by === 'human'`.

### 3.3 Fix outstanding issues (as needed, 60 min)

- [ ] `pnpm lint` — zero errors/warnings; `pnpm -r typecheck` — zero errors.
- [ ] Verify `packages/multi-agent` boundary holds; no primitive bypasses the budget.

### 3.4 Week 5 retro (45 min)

File: `docs/retros/week-05-phase3.md` (`# Week 5 Phase 3 Retro — Multi-agent, bounded`), standard sections.

Prompts: Did any primitive actually try to loop unbounded in the demo? Is the role-tier mapping too permissive (esp. TESTER `write_file`)? Is the Decomposer's guardrail set too strict/loose on real goals? Human-gate bypasses — any close calls?

### 3.5 Update wiring map + README (30 min)

- [ ] `docs/architecture/wiring-map.md` — primitives, roles, `BoundedLoop`, Decomposer.
- [ ] `README.md` — "Phase 3 Week 5 Status" note.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `scripts/demo-week5.ts` | Multi-agent demo |
| `apps/api/src/__tests__/week5-guardrails.test.ts` | Four guardrail proofs |
| `docs/retros/week-05-phase3.md` | Retrospective |
| `README.md` (updated) | Week 5 status section |

---

## 5. Acceptance Criteria

- [ ] Multi-agent demo runs end-to-end and lands at the human gate (never auto-decides).
- [ ] Runaway guard proven live (halts + escalates).
- [ ] No-progress guard proven live (escalates before budget exhausted).
- [ ] Role-bypass rejection proven (REVIEWER write rejected pre-dispatch).
- [ ] AI-review-never-decides proven (`triggered_by === 'human'`; verdict-bearing review output rejected).
- [ ] `pnpm --filter @harness/multi-agent test` — all pass; `pnpm lint` — zero errors.
- [ ] `docs/retros/week-05-phase3.md` exists.

**Checkpoint rule:** If any guardrail proof is red, stop. Week 6 (benchmark + judge) builds *on* the assumption that multi-agent loops are safely bounded — an unbounded loop feeding a judge is a trust failure squared.

---

## 6. Notes & Pitfalls

- **A proof is a failing test that passes.** "Guardrail proof" means a test that would fail if the guard were absent, now green. Demonstrations without a corresponding negative assertion are just demos.
- **The demo must end at the human.** A multi-agent demo that concludes with "and it auto-approved" is a *warning*, not a success. The point of the whole system is that AI execution converges on human attention.
- **Guard against demo-only guardrails.** If a guard fails in the demo script but "works in the unit test," the unit test is too narrow or the demo path bypasses the guard — find which, today.
- **Do not start the benchmark corpus today.** Week 6 (gold labels + judge) is a fresh subsystem with its own invariants. A clean multi-agent checkpoint with proven guardrails is the required foundation.
- **Tomorrow (Day 26):** benchmark corpus — versioned gold labels (SWE-bench-style tasks) (Spec 11 §5.1).

---

*Prev: [Day 24 — Decomposer: 3-Level Hierarchical Planning, Plan-and-Solve/ReWOO, Dynamic Replanning](day-24.md) | Next: [Day 26 — Benchmark Corpus: Versioned Gold Labels (SWE-bench-style Tasks)](day-26.md)*
