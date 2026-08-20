# Day 38 — Docs: Specs to v1.0 Candidates, Runbook + Dev Guide

| | |
|---|---|
| **Week** | 8 — Harden, document, exit |
| **Spec refs** | Spec 1 §1 (docs are a deliverable), Architecture §24 (doc lifecycle), all 11 specs |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 37 (E2E full system under load) |

---

## 1. Objectives

By end of day you will have:

1. **Spec v1.0 candidates**: the eleven v0.1/v0.2 specs promoted to v1.0-candidate with Phase-3 reality reconciled into them — no remaining "planned"/"TBD" sections for shipped features, and any deferred work flagged explicitly.
2. A **runbook**: how to operate the system (start, monitor, judge graph, closed-loop oversight, rollback a calibration update, diagnose a runaway/memory spiral, durable-queue recovery).
3. A **dev guide**: how to onboard, contribute, and extend the system — covering seams, `IEventBus`, `LLMProvider`, DI/TOKENS, boundary rules, and "how to add a new memory kind / role / re-ranker" recipes.

Docs are the phase deliverable that makes the system *repeatable by others*, not just by its authors.

---

## 2. Design Decisions

### 2.1 v1.0 candidate = reality, reconciled

A spec becomes a v1.0 candidate by *reconciling it with what was built*, not by sweeping "TODO"s:
- every feature shipped → described as built (with the actual package/seam/column names);
- every feature deferred → explicit "deferred to v1.1/2.0" section with a reason;
- every invariant → restated with the *test/file* that enforces it (a doc claim links to its proof).

No spec stays at "0.2 + wishlist."

### 2.2 One reconciling pass per spec, not a rewrite

For each of the 11 specs: focus on the sections Phase 3 *changed or added* (memory, hybrid, multi-agent, decomposer, benchmark, judge, learning loop), and touch nothing else. Preserve the `Spec N — Title` structure and cross-reference convention (`Spec N §X.Y`).

### 2.3 Runbook structure (ops-facing)

| Section | Contents |
|---------|----------|
| Startup/health | boot order, health endpoints, seed/freeze state |
| Judge + loop supervision | read `judge_agreement`, track `calibration_updates`, approve a `notable_change` |
| Rollback | `calibration.update_rolled_back`, restore `before`, prior ranking config |
| Incident playbooks | runaway loop, memory spiral, hybrid-latency spike, poison event |
| Durable queue ops | enable Redis/SQS, dead-letter recovery, replay |

### 2.4 Dev guide structure (contributor-facing)

| Section | Contents |
|---------|----------|
| Onboarding | pnpm/turbo, packages, DI/TOKENS, boundary rules |
| Seams | `IEventBus`, `LLMProvider`, `Retriever`, `Ranker`, `ContentStore` |
| Recipes | add a memory kind / role / re-ranker / benchmark task |
| Testing conventions | Phase 1 style tests, architecture tests, MockLLM determinism |

### 2.5 Docs are versioned, not ad-hoc

v1.0 candidates live alongside the source they describe (`docs/core/*_v1.0.md` or a `v1.0-candidate/` dir), with the runbook + dev guide in `docs/`. A "docs" change is a normal change — reviewed, not a side effect.

---

## 3. Tasks

### 3.1 Spec v1.0 candidates (180 min)

- [ ] Reconcile the 11 specs: built-as / deferred / invariant-to-proof mapping (§2.1–2.2).
- [ ] Promote to `_v1.0.md` candidates; update the spec index.

### 3.2 Runbook (120 min)

- [ ] `docs/runbook.md` per §2.3; include the exact rollback and incident steps.

### 3.3 Dev guide (120 min)

- [ ] `docs/dev-guide.md` per §2.4; include seams + recipes.

### 3.4 Cross-link + consistency check (60 min)

- [ ] Ensure every spec section referenced in the 40 day files resolves; fix dangling `Spec N §X.Y` references.
- [ ] Wire runbook/dev-guide into `docs/README` + `docs/summary/HAI_overview.md`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `docs/core/1..11_*.md` (v1.0 candidates) | Specs reconciled + promoted |
| `docs/runbook.md` | Ops runbook |
| `docs/dev-guide.md` | Contributor dev guide |
| `docs/summary/HAI_overview.md` (updated) | Cross-linked |

---

## 5. Acceptance Criteria

- [ ] All 11 specs have v1.0-candidate editions; no shipped feature left as "planned/TBD".
- [ ] Deferred work is explicitly flagged with reason + target version.
- [ ] Every invariant claim links to the test/file that enforces it.
- [ ] Runbook covers startup, loop oversight, rollback, and the four incident playbooks.
- [ ] Dev guide covers seams, boundary rules, DI/TOKENS, and ≥3 extension recipes.
- [ ] No dangling `Spec N §X.Y` references across the 40 day files.
- [ ] `pnpm lint` clean (docs link-check passes).

---

## 6. Notes & Pitfalls

- **Docs are a first-class deliverable, not cleanup.** A system whose specs still say "planned" for shipped features is a system that can't be handed off or safely extended. Reconcile, don't wallpaper.
- **A v1.0 candidate that hides deferrals is worse than one that lists them.** "Deferred to v1.1" is honest and useful; silently resolving a TODO as if it shipped is how the next reader builds on a non-existent feature.
- **Link every invariant to its proof.** A spec that says "AI never decides" is a philosophy; a spec that cites the guardrail test is a contract. The 40 day files already encode this; carry it into the specs.
- **Runbook rollback must match the actual code paths.** If the runbook says "restore `before`" but `calibration.update_rolled_back` doesn't exist, the runbook is fiction. Write from the implemented seams.
- **Keep docs reviewed.** Doc changes ride the same review discipline as code — a docs-only change that misstates the invariant is still a correctness bug.
- **Tomorrow (Day 39):** benchmark regression + judge-agreement report.

---

*Prev: [Day 37 — E2E Full System Under Phase-3 Infrastructure + Load Profile](day-37.md) | Next: [Day 39 — Benchmark Regression + Judge-Agreement Report](day-39.md)*
