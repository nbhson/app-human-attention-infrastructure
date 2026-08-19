# Day 25 — E2E Vertical Slice: Happy Path

| | |
|---|---|
| **Week** | 4 — Human Loop & E2E |
| **Spec refs** | Spec 1 §6 (E2E flow), all specs (integration) |
| **Estimated effort** | 6 h |
| **Prerequisites** | Days 1–24 complete; Week 3 checkpoint green |

---

## 1. Objectives

1. Write and pass the **first full E2E test**: task created → context → agent executes (MockLLM) → verification PASSED → attention assessed → routed → human approves via API → merged → COMPLETED.
2. Run it against the **real Compose stack** (Postgres, API, web) — not mocks of our own system.
3. Produce the **demo script** used on Day 30.
4. Fix whatever breaks. Something will break; today has slack for it.

> **Why this matters:** 24 days of green unit tests can still hide a system that doesn't work when assembled. The vertical slice is the first time the harness's promise — "AI works, evidence flows, human decides" — is tested as one sentence instead of seven chapters.

---

## 2. Design Decisions

### 2.1 The scenario

`fixtures/e2e/happy-path/`: a tiny TypeScript project (a `greeting.ts` with a deliberate bug + a failing test). Task: *"Fix the greeting bug in src/greeting.ts."* MockLLM script (Day 11): read_file → write_file (the fix) → done. Verification: compile + vitest pass.

### 2.2 The E2E harness

`scripts/e2e-happy-path.ts` (also runnable as a Vitest e2e suite with the `e2e` tag):

```ts
// Phase markers — each step asserts DB state, not just "no error"
const task = await api.createTask({ description: 'Fix the greeting bug', targetFiles: ['src/greeting.ts'] });
await waitFor(() => taskState(task.id) === 'AWAITING_REVIEW', { timeout: 120_000 });

// Assert the trust pipeline fired in order
assert(await contextSnapshotExists(task.id));            // Day 20
assert((await verificationReport(task.id)).overall === 'PASSED');
assert(await evidenceCount(task.id) >= 1);               // Day-17 invariant
const assessment = await getAssessment(task.id);         // Day 18
const queueItem = await getQueueItem(task.id);           // Day 19
assert(queueItem.rule_id === expectedRule(assessment.label));

// Human loop via the real API (Day 22/24)
await api.claim(queueItem.id, REVIEWER);
await api.decide(queueItem.id, { decision: 'APPROVE', rationale: 'fix is correct', wasUseful: true });
await waitFor(() => taskState(task.id) === 'COMPLETED', { timeout: 30_000 });
assert((await getChange(task.id)).metadata.commit_sha);  // Day 24
assert((await getArtifacts(task.id)).every(a => a.status === 'MERGED'));
```

### 2.3 Event-order assertion

Query `event_log` by `correlation_id = task.id` and assert the causal chain appears in order: `task.created → task.state_changed(QUEUED) → … → verification.completed → attention.assessment_created → attention.item_routed → review.decision_submitted → artifact.merged`. This is the provenance backbone working as designed (Spec 1: full provenance).

---

## 3. Tasks

- [ ] **3.1** Build `fixtures/e2e/happy-path/` project + MockLLM script. (1 h)
- [ ] **3.2** `scripts/e2e-happy-path.ts` with phase assertions + event-order check. (2 h)
- [ ] **3.3** Run against Compose stack; fix integration bugs (budget the slack here). (2 h)
- [ ] **3.4** Convert to repeatable `pnpm e2e` script + CI job definition. (30 min)
- [ ] **3.5** Draft the Day-30 demo script from the working run. (30 min)

---

## 4. Deliverables

| File | Description |
|---|---|
| `fixtures/e2e/happy-path/` | Demo project + MockLLM script |
| `scripts/e2e-happy-path.ts` | E2E test / demo driver |

---

## 5. Acceptance Criteria

- [ ] `pnpm e2e` green against a clean Compose stack (`docker compose up -d` from scratch).
- [ ] All phase assertions pass; event chain in `event_log` matches the expected causal order.
- [ ] Total wall-clock < 3 min with MockLLM.
- [ ] Demo script draft exists.

---

## 6. Notes & Pitfalls

- **Assert DB state, not log lines** — logs lie (or get reformatted); the database is the system's memory.
- **Timeouts are symptoms** — if `waitFor` needs > 2 min with MockLLM, find the real bottleneck (usually polling intervals or a missing index) instead of raising the timeout.
- **Clean-slate runs only** — the e2e script must reset the DB (`pnpm db:reset`) before running; a test that only passes on a warm database is not a test.
- **Next:** [Day 26 — E2E: Failure Paths & Provenance UI](day-26.md) — the happy path works; now break things on purpose.

---

*Prev: [Day 24 — Decision Flow: Merge on Approve, Rework on Reject](day-24.md) | Next: [Day 26 — E2E: Failure Paths & Provenance UI](day-26.md)*
