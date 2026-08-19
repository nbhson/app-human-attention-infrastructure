# Day 26 — E2E: Failure Paths & Provenance UI

| | |
|---|---|
| **Week** | 4 — Human Loop & E2E |
| **Spec refs** | Spec 1 §5 (provenance), Spec 2 §7 (failure states), Spec 7 §5.6 (flaky), Spec 3 §6 (escalation) |
| **Estimated effort** | 6 h |
| **Prerequisites** | Day 25 (happy path green), Day 17 (buildProvenanceChain), Day 23 (UI patterns) |

---

## 1. Objectives

1. E2E-test the **failure paths** — the harness earns trust by failing well, not by never failing.
2. Build the **provenance page** in `apps/web`: render the Day-17 `ProvenanceChain` for any task.
3. Verify every failure lands in a **defined state with evidence**, never a limbo.

> **Why this matters:** reviewers will ask "why did this task fail?" far more often than "why did it succeed?". If the answer requires `docker logs` archaeology, the provenance design failed. Today makes failure a first-class, inspectable outcome.

---

## 2. Design Decisions

### 2.1 Failure-path E2E matrix (`scripts/e2e-failure-paths.ts`)

| # | Scenario | Expected end state | Key assertions |
|---|---|---|---|
| 1 | Verification FAILED (compile error in agent output) | REWORK → QUEUED (attempt 2) | report persisted w/ evidence; retry_log row; attempt incremented once |
| 2 | Verification FAILED at max_attempts | FAILED | `task.failed` event w/ reason; no 4th attempt |
| 3 | Flaky test (fail→pass) | AWAITING_REVIEW, routed REVIEW_REQUIRED | report `flaky: true`; rule r3 fired regardless of label |
| 4 | Agent exceeds max steps (MockLLM loops) | ESCALATED + AWAITING_HUMAN_INTERVENTION | `agent_runs.escalation_reason` set; trajectory complete |
| 5 | Token budget exceeded | step failure RESOURCE → retried per policy | TokenBudgetExceededError classified RESOURCE (Day 10) |
| 6 | Human rejects with rationale | REWORK → QUEUED; rationale in next prompt | Day-24 path, asserted via MockLLM `calls` record |
| 7 | Merge conflict on approve | AWAITING_HUMAN_INTERVENTION (MERGE_FAILED) | no partial commit; artifacts stay REVIEWED |
| 8 | API killed mid-execution (SIGTERM) | graceful drain; task resumable | no orphaned EXECUTING row after restart |

Each scenario is a function reusing Day-25 helpers (`waitFor`, DB assertions, event-order checks).

### 2.2 Provenance page (`/tasks/:id/provenance`)

Renders `GET /api/tasks/:id/provenance` (thin route over Day-17 `buildProvenanceChain`):

```
Task: Fix the greeting bug          State: COMPLETED (attempt 1)
├─ Agent Run #r_01  (12 steps, 3 LLM calls, 1,204 tokens)
│   └─ Trajectory: read_file → write_file → done   [expand]
├─ Artifacts (1)
│   └─ src/greeting.ts  snapshot sha256:9f2c…  status MERGED
├─ Verification: PASSED
│   ├─ COMPILE PASSED   evidence e_88 [view]
│   └─ TEST PASSED      evidence e_89 [view]
├─ Attention: HIGH (0.74) → rule r2-high (policy v1)
├─ Review: APPROVED by son.nguyen — "fix is correct"
└─ Events (14)  [timeline]
```

- Timeline renders `event_log` rows for the correlation id, oldest first, with relative timestamps.
- Every evidence badge opens the raw body (same modal component as Day 23).

---

## 3. Tasks

- [ ] **3.1** Failure scenarios 1–3 (verification paths). (1.5 h)
- [ ] **3.2** Failure scenarios 4–5 (runtime paths). (1 h)
- [ ] **3.3** Failure scenarios 6–8 (human/ops paths, incl. kill-and-restart). (1.5 h)
- [ ] **3.4** `GET /api/tasks/:id/provenance` route. (30 min)
- [ ] **3.5** Provenance page + timeline component. (1.5 h)

---

## 4. Deliverables

| File | Description |
|---|---|
| `scripts/e2e-failure-paths.ts` | 8-scenario failure E2E suite |
| `apps/api/src/routes/provenance.ts` | Provenance endpoint |
| `apps/web/src/pages/ProvenancePage.tsx` | Provenance UI |

---

## 5. Acceptance Criteria

- [ ] All 8 failure scenarios pass against a clean Compose stack.
- [ ] No scenario leaves a task in a non-terminal, non-queued state without a recorded reason.
- [ ] Provenance page renders all 7 chain sections for both a COMPLETED and a FAILED task.
- [ ] `pnpm e2e` (happy + failure) green; `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Scenario 8 (kill test) is the one teams skip** — don't. A queue that orphans EXECUTING rows on restart will bite in the first week of real use.
- **Failure fixtures must be deterministic** — the flaky fixture uses the Day-16 counter-file technique, never `Math.random()`.
- **Provenance is read-only** — any "fix it from the UI" button is out of scope; intervention happens via the review queue or direct DB/CLI runbook (Day 29).
- **Next:** [Day 27 — Observability: Logs, Correlation IDs & Audit Queries](day-27.md).

---

*Prev: [Day 25 — E2E Vertical Slice: Happy Path](day-25.md) | Next: [Day 27 — Observability: Logs, Correlation IDs & Audit Queries](day-27.md)*
