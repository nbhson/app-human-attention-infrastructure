# Day 28 — Hardening: Concurrency, Failure Injection & Load Smoke

| **Week** | Week 4 — Human Loop & E2E |
| --- | --- |
| **Spec refs** | Spec 1 §6 (Non-goals guardrails), Spec 2 §7 (Concurrency), Spec 3 §6 (Runtime Isolation) |
| **Estimated effort** | 1 day |
| **Prerequisites** | Day 25–26 (E2E suite), Day 27 (observability — you'll need Q8 and the propagation test to *see* what hardening breaks) |

---

## 1. Objectives

1. Prove the system survives **concurrent pressure**: multiple dispatchers, multiple reviewers, parallel tasks — no double-dispatch, no double-claim, no lost updates.
2. Prove the system degrades gracefully under **injected failures**: DB connection drops, LLM timeouts, disk-full writes, mid-transaction crashes.
3. Run a **load smoke test** (not a benchmark): 50 tasks through the full pipeline, confirming no deadlock, no unbounded growth, no orphaned state.
4. Fix what breaks — or explicitly document it as a known Phase-1 limitation in the runbook.

> **Why this matters:** Every guarantee this harness sells — "no task runs twice", "every decision is auditable", "evidence before confidence" — is a concurrency claim. SKIP LOCKED, optimistic locking, guarded UPDATEs, and idempotency keys were all written by hand and tested one-at-a-time. Today they meet each other. Bugs found today cost an hour; the same bugs found in production cost trust, and trust is the product.

---

## 2. Design Decisions

### 2.1 Concurrency test matrix

Each test runs against the real Compose stack (no mocks — mocks can't race):

| # | Scenario | Setup | Invariant asserted |
| --- | --- | --- | --- |
| C1 | Double dispatch | 2 Dispatcher loops (200ms interval) + 10 PENDING tasks | Each task reaches QUEUED exactly once; `dispatch_log` has 1 row per idempotency_key (unique constraint holds) |
| C2 | Double poll | 2 RuntimePollLoops + 5 QUEUED tasks | Each task gets exactly 1 `agent_runs` row; SKIP LOCKED prevents double-claim |
| C3 | Concurrent state transition | 2 threads transition same task QUEUED→EXECUTING simultaneously | Exactly one succeeds; loser gets `StateConflictError`; `task_state_history` has no duplicate rows |
| C4 | Double review claim | 2 reviewers POST /claim on same queue item concurrently | One 200, one 409 `QueueConflictError`; `review_queue.claimed_by` is single-valued |
| C5 | Double decide | 2 POST /decide on same CLAIMED item | One succeeds; second gets 409; exactly 1 `review_decisions` row; task transitions once |
| C6 | Event idempotency | Publish same event envelope twice (same event_id) | `event_log` has 1 row (`onConflictDoNothing`); subscribers see it once |
| C7 | Parallel tasks, shared files | 5 tasks all writing `src/shared.ts` in separate worktrees | No cross-contamination; each change's snapshot hashes differ or match their own content only |

C1–C5 are the money tests — they directly validate the architectural bets from Days 6, 8, and 22.

### 2.2 Failure injection harness

A tiny, reusable fault-injection module for tests only:

```ts
// packages/db/src/testing/faults.ts (test-only export, never in production path)
export class FaultyDb {
  constructor(private inner: Db, private fault: Fault) {}
  // Wraps Kysely: throws PG connection error after N successful queries,
  // or on demand via .trip()
}

export type Fault =
  | { kind: 'connection-drop'; afterQueries: number }
  | { kind: 'slow'; delayMs: number }          // exceed the 120s VERIFY timeout? no — use small delays to test retry paths
  | { kind: 'disk-full'; onTable: string };     // INSERT into evidence throws ENOSPC-like error
```

Scenarios:

| # | Injected fault | Expected behavior |
| --- | --- | --- |
| F1 | DB drops mid-`transitionTask` | API returns 500; task state unchanged (transaction rolled back); retry of the same request succeeds (idempotency) |
| F2 | LLM call hangs past timeout | ReActLoop step times out → TRANSIENT → retry per Day-10 policy; `retry_log` row exists |
| F3 | `evidence` INSERT fails (disk-full) | Verification report NOT marked PASSED (invariant: no PASSED without evidence); task → AWAITING_HUMAN_INTERVENTION; error logged with correlation_id |
| F4 | SIGKILL the API process mid-EXECUTING (not SIGTERM — the rude one) | On restart: startup reconciler finds orphaned EXECUTING task (Q8 logic), moves it to AWAITING_HUMAN_INTERVENTION with reason `PROCESS_DIED`; event published |
| F5 | Postgres container restarted mid-dispatch | Dispatcher loop logs error, backs off, resumes; no task lost, none double-dispatched |

**F4 forces a new component: the startup reconciler.** Until today, SIGTERM (graceful) was handled but SIGKILL left orphans. Add to `bootstrap.ts`:

```ts
// apps/api/src/bootstrap.ts — runs once at startup, before loops start
async function reconcileOrphans(db: Db, bus: IEventBus, log: Logger): Promise<void> {
  const orphans = await db.selectFrom('tasks')
    .where('state', 'in', ['EXECUTING', 'VERIFYING'])
    .selectAll().execute();
  for (const t of orphans) {
    await transitionTask(db, t.id, 'AWAITING_HUMAN_INTERVENTION', {
      expected: t.state, reason: 'PROCESS_DIED',
    });
    await bus.publish(envelope('task.orphan_recovered', t.correlation_id, { taskId: t.id }));
    log.warn({ taskId: t.id }, 'orphaned task recovered at startup');
  }
}
```

This is the *only* sanctioned auto-repair, and it fails toward human attention — consistent with the Day-27 "smoke alarm" philosophy, but at startup (single-writer moment) it's safe to act.

### 2.3 Load smoke test

`scripts/load-smoke.ts`:

- Seed 50 tasks (varied: 30 happy-path, 10 verification-fail-then-rework, 5 flaky, 5 max-steps-escalation) using MockLLM scripts — **no real API keys**.
- Run 2 dispatchers + 2 runtime loops + 1 verification worker against the Compose stack.
- Assertions after drain (all tasks terminal or AWAITING_REVIEW):
  - `event_log` row count is within expected bounds (no event storms — e.g. < 40 events/task average)
  - Q8 orphan query returns 0
  - No `tasks` row stuck in a non-terminal state for > 5 min
  - `review_queue` depth = expected count (30 happy + 5 flaky + rework survivors)
  - Wall-clock < 15 min on a dev laptop; report timings but **do not tune** — this is a smoke test, not a benchmark
- Output a one-page summary table (per-scenario counts, p50/p95 task duration, LLM calls total) — paste into the Day-30 retro.

### 2.4 What we explicitly do NOT harden in Phase 1

- Multi-host deployment (single process, single DB — documented limitation)
- Network partitions / split brain (n/a: one node)
- Backpressure / queue shedding (50-task smoke is the ceiling; note in runbook)
- Chaos-monkey style random faults (deterministic injection only — reproducibility beats coverage here)

---

## 3. Tasks

### 3.1 Concurrency suite (3h)
- [ ] Implement C1–C5 as integration tests in `apps/api/test/concurrency/` (real DB, real routes, `Promise.all` racers)
- [ ] Implement C6 (event idempotency) and C7 (parallel worktrees)
- [ ] Fix any violations found — expected candidates: missing unique constraint, unguarded UPDATE

### 3.2 Failure injection (2.5h)
- [ ] Build `FaultyDb` test wrapper
- [ ] Implement F1–F3, F5
- [ ] Implement F4 + the startup reconciler + `task.orphan_recovered` event type (event_version 1)

### 3.3 Load smoke (1.5h)
- [ ] Write `scripts/load-smoke.ts` + fixtures for the 4 scenario mixes
- [ ] Run 3 consecutive times; all must pass; record timings

### 3.4 Documentation (1h)
- [ ] Add "Known Phase-1 Limitations" section to `docs/runbook/` (single-node, no backpressure, reconciler behavior)
- [ ] Update wiring map with reconciler; update audit cookbook with `task.orphan_recovered` example

---

## 4. Deliverables

| File | Description |
| --- | --- |
| `apps/api/test/concurrency/*.test.ts` | C1–C7 concurrency suite |
| `packages/db/src/testing/faults.ts` | FaultyDb fault-injection wrapper (test-only) |
| `apps/api/test/faults/*.test.ts` | F1–F5 failure-injection suite |
| `apps/api/src/reconcile.ts` | Startup orphan reconciler |
| `scripts/load-smoke.ts` | 50-task load smoke runner (`pnpm load:smoke`) |
| `docs/runbook/limitations.md` | Known Phase-1 limitations & operational ceilings |

---

## 5. Acceptance Criteria

- [ ] C1–C7 all pass; any bug found is either fixed or written into `limitations.md` with a Phase-2 ticket reference
- [ ] F1–F5 all pass; F4's reconciler proven by SIGKILL-ing a live run and observing recovery on restart
- [ ] `pnpm load:smoke` passes 3/3 consecutive runs; no orphans (Q8), no stuck tasks, queue depth matches expectation
- [ ] `task.orphan_recovered` appears in event_log with correct correlation_id after F4
- [ ] No PASSED verification report exists without ≥1 evidence row after the full fault suite (invariant re-checked under duress)
- [ ] `pnpm test && pnpm lint && pnpm e2e` all green

---

## 6. Notes & Pitfalls

- **Races are timing-sensitive — make them deterministic.** Don't `setTimeout` and pray. Use barriers: acquire both workers, hold one with a deferred promise, release simultaneously. A flaky concurrency test is worse than none because it teaches people to ignore red.
- **When a concurrency test fails, suspect the schema first.** Nine times out of ten the fix is a missing UNIQUE constraint or a forgotten `WHERE status = ...` guard — not application logic. The DB is your concurrency primitive; that's why we chose Postgres.
- **The reconciler must run before any loop starts.** If the Dispatcher starts while orphans are still EXECUTING, you've violated single-writer. Order in `bootstrap.ts`: reconcile → then start loops. Add a comment; someone will reorder it otherwise.
- **Load smoke numbers are not SLAs.** If p95 is 4 minutes, write it down and move on. Performance tuning without a real workload is how Phase-1 projects die. The Day-30 backlog gets a "performance baseline" item, not a tuning sprint.
- **Next:** [Day 29 — Documentation: Specs v0.2, Dev Guide & Runbook](day-29.md).

---

*Prev: [Day 27 — Observability: Logs, Correlation IDs & Audit Queries](day-27.md) | Next: [Day 29 — Documentation: Specs v0.2, Dev Guide & Runbook](day-29.md)*
