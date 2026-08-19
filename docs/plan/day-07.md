# Day 07 — Week 1 Integration Checkpoint

| | |
|---|---|
| **Week** | 1 — Foundation |
| **Spec refs** | All Week 1 specs (1, 2 §3/§4/§8) |
| **Estimated effort** | 4–5 hours |
| **Prerequisites** | Day 06 (TaskStateMachine, TaskService) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A passing **end-to-end smoke test** that exercises the full Week 1 stack: task created → state machine transitions → events published → events persisted to `event_log`.
2. A **CI pipeline** that runs lint + typecheck + all unit tests on every push.
3. A **Week 1 retrospective note** capturing what is solid, what is fragile, and what to watch in Week 2.
4. Confidence that the foundation is ready for Week 2 (Orchestrator dispatch + Agent Runtime).

**Do not proceed to Day 08 until every acceptance criterion in §5 is green.**

---

## 2. What Week 1 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Monorepo scaffold, tooling, CI skeleton | root | ✅ Day 01 |
| Core domain types + branded IDs | `@harness/domain` | ✅ Day 02 |
| Event envelope + `IEventBus` | `@harness/event-bus` | ✅ Day 03 |
| PostgreSQL schema + migrations + `EventLogWriter` | `@harness/db` | ✅ Day 04 |
| DI container + boundary enforcement | `@harness/di` | ✅ Day 05 |
| Task state machine + `TaskService` | `@harness/orchestrator` | ✅ Day 06 |

---

## 3. Tasks

### 3.1 Write the E2E smoke test (120 min)

File: `apps/api/src/__tests__/week1-smoke.test.ts`

This test runs against a real PostgreSQL instance (use `harness_test` schema) and the real `InProcessEventBus`. No mocks.

```typescript
// Pseudocode — adapt to your actual APIs
describe('Week 1 Smoke Test', () => {
  it('task lifecycle: create → queue → execute → verify → review → approve → complete', async () => {
    const container = buildContainer(); // real DI container
    const taskService  = container.resolve<TaskService>(TOKENS.TaskService);
    const bus          = container.resolve<IEventBus>(TOKENS.EventBus);
    const db           = container.resolve<DrizzleDB>(TOKENS.Db);

    // 1. Create task
    const task = await taskService.createTask({ title: 'Smoke test task', projectId: seedProjectId });
    expect(task.state).toBe('PENDING');

    // 2. Walk through all legal transitions
    await taskService.transitionTask(task.id, 'QUEUED',          'orchestrator');
    await taskService.transitionTask(task.id, 'EXECUTING',       'agent_runtime');
    await taskService.transitionTask(task.id, 'VERIFYING',       'agent_runtime');
    await taskService.transitionTask(task.id, 'AWAITING_REVIEW', 'verification_engine');
    await taskService.transitionTask(task.id, 'APPROVED',        'human', { rationale: 'LGTM', reviewerId: 'reviewer-1' });
    await taskService.transitionTask(task.id, 'COMPLETED',       'orchestrator');

    // 3. Assert final state
    const final = await taskService.getTask(task.id);
    expect(final?.state).toBe('COMPLETED');

    // 4. Assert history (7 rows: create is not a transition)
    const history = await taskService.getTaskHistory(task.id);
    expect(history).toHaveLength(6); // 6 transitions

    // 5. Assert event_log has 6 task.state_changed rows for this task
    const events = await db.select().from(eventLog)
      .where(eq(eventLog.correlation_id, task.id))
      .where(eq(eventLog.event_type, 'task.state_changed'));
    expect(events).toHaveLength(6);
  });

  it('illegal transition is rejected with descriptive error', async () => {
    const task = await taskService.createTask({ title: 'Illegal test', projectId: seedProjectId });
    await expect(
      taskService.transitionTask(task.id, 'EXECUTING', 'orchestrator')
    ).rejects.toThrow(IllegalTransitionError);
  });

  it('duplicate event_id in event_log is silently ignored (idempotency)', async () => {
    // Publish the same event envelope twice; second write must not throw or duplicate
    const writer = container.resolve<EventLogWriter>(TOKENS.EventLogWriter);
    const event  = createEvent('task.state_changed', taskId, payload);
    await writer.write(event);
    await expect(writer.write(event)).resolves.not.toThrow();
    const rows = await db.select().from(eventLog).where(eq(eventLog.event_id, event.event_id));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] All 3 smoke tests pass against `harness_test` schema.
- [ ] Test setup/teardown creates and drops `harness_test` schema cleanly.

### 3.2 Harden the CI pipeline (60 min)

Update `.github/workflows/ci.yml` (scaffolded Day 01) to run the full gate:

```yaml
jobs:
  gate:
    steps:
      - name: Lint
        run: pnpm lint
      - name: Typecheck
        run: pnpm -r typecheck
      - name: Unit tests (no DB)
        run: pnpm -r test -- --exclude='**/*.integration.test.ts'
      - name: Start Postgres
        run: docker compose up -d postgres && docker compose wait postgres
      - name: Migrate test DB
        run: DATABASE_URL=postgres://harness:harness@localhost:5432/harness_test pnpm --filter @harness/db migrate
      - name: Integration tests
        run: pnpm -r test -- --include='**/*.integration.test.ts'
```

- [ ] CI passes on the current branch.
- [ ] CI fails when a deliberately illegal import is added (verify, then revert).

### 3.3 Fix all outstanding lint/type errors (as needed, up to 60 min)

- [ ] `pnpm lint` — zero errors, zero warnings.
- [ ] `pnpm -r typecheck` — zero errors across all packages.
- [ ] Fix any `any` types that crept in during the week.

### 3.4 Write Week 1 retrospective (45 min)

File: `docs/retros/week-01.md`

Use this structure:

```markdown
# Week 1 Retro — Foundation

## What is solid
- ...

## What is fragile
- ... (be honest — this document is for you, not for stakeholders)

## Decisions that need revisiting before Phase 2
- ...

## Watch items for Week 2
- ...
```

Prompts to answer:
- Is the `EventLogWriter` fire-and-forget pattern acceptable for Week 2's event volume?
- Did any state transitions feel missing or wrong? (If yes, note them — do not change the state machine now; flag for spec v0.2 on Day 29.)
- Is the DI container scaling well, or is `bootstrap.ts` already hard to read?
- Any boundary violations that were tempting but resisted?

### 3.5 Update wiring map and README (15 min)

- [ ] `docs/architecture/wiring-map.md` — confirm all Week 1 registrations are listed.
- [ ] `README.md` (root) — add a "Week 1 Status" badge/section: what works, how to run it.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/__tests__/week1-smoke.test.ts` | E2E smoke test |
| `.github/workflows/ci.yml` (updated) | Full CI gate |
| `docs/retros/week-01.md` | Retrospective |
| `README.md` (updated) | Week 1 status section |

---

## 5. Acceptance Criteria

- [ ] All 3 smoke tests pass against a real PostgreSQL instance.
- [ ] CI pipeline passes on push.
- [ ] `pnpm lint` — zero errors.
- [ ] `pnpm -r typecheck` — zero errors.
- [ ] `pnpm -r test` — all tests pass (unit + integration).
- [ ] `docs/retros/week-01.md` exists and is honest (not a rubber-stamp).
- [ ] No package in `packages/` has a dependency on another engine package (verify with architecture test).
- [ ] `event_log` contains rows for every state transition made during the smoke test.

**Checkpoint rule:** If any criterion is red, stop. Fix it today. Do not carry a red foundation into Week 2.

---

## 6. Notes & Pitfalls

- **The smoke test is not optional.** It is the only thing standing between "we built a bunch of packages" and "we built a system that works." Treat it as the deliverable, not an afterthought.
- **`harness_test` schema isolation:** if smoke tests are leaving residue between runs, the teardown is wrong. Drop and recreate the schema, not just truncate tables.
- **CI Postgres service:** use a GitHub Actions service container for Postgres in CI, not `docker compose` — it is faster and more reliable. The `docker compose wait` step in §3.2 is a local-dev convenience.
- **Retro honesty:** the retro is a private working document. "What is fragile" should name real fragility. If you write "nothing is fragile," you are not looking hard enough.
- **Do not start Week 2 features today.** The temptation to "just quickly scaffold the dispatch loop" while the smoke test passes is real. Resist it. A clean checkpoint is worth more than a head start.

---

*Prev: [Day 06 — Canonical Task State Machine](day-06.md) | Next: [Day 08 — Orchestrator Core: Queue & Pull Dispatch](day-08.md)*
