# Day 15 — Verification Engine: Request Handler & Compile Check

| | |
|---|---|
| **Week** | 3 — Trust Pipeline |
| **Spec refs** | Spec 7 — Verification Engine (v0.1, updated); Spec 5 §3.1 |
| **Estimated effort** | 6–7 h |
| **Prerequisites** | Day 14 (changes/artifacts VERIFIED subscriber), Day 09 (VERIFY step stub) |

---

## 1. Objectives

1. Stand up `packages/verification-engine` with its public entry point: `VerificationEngine.verify(changeId)` returning a `VerificationReport`.
2. Implement the **Check abstraction** (`VerificationCheck` interface) and the Phase-1 **Full/Parallel** execution strategy (per spec fix: Targeted/Incremental deferred to Phase 3).
3. Ship the first real check: **CompileCheck** (`tsc --noEmit`) running **in-process on the agent's dedicated branch/worktree** (spec §5.5 Execution Environment).
4. Wire the Day-09 VERIFY `StepHandler` stub to call the engine and publish `verification.completed` (consumed by Day-14 ChangeStatusSubscriber).
5. Apply the **two timeout levels** from the spec fix: per-check timeout vs request-level timeout (§5.7).

> **Why this matters:** verification is where "Claim ≠ Evidence" gets enforced. Today establishes the contract every later check (tests Day 16, lint/type/future checks) plugs into.

---

## 2. Design Decisions

### 2.1 Types (extends `@harness/domain`)

```ts
// packages/verification-engine/src/types.ts
export const CheckKind = { COMPILE: 'COMPILE', TEST: 'TEST', LINT: 'LINT' } as const;
export type CheckKind = typeof CheckKind[keyof typeof CheckKind];

export const CheckStatus = { PASSED: 'PASSED', FAILED: 'FAILED', FLAKY: 'FLAKY', TIMED_OUT: 'TIMED_OUT', SKIPPED: 'SKIPPED' } as const;
export type CheckStatus = typeof CheckStatus[keyof typeof CheckStatus];

export interface CheckResult {
  checkKind: CheckKind;
  status: CheckStatus;
  durationMs: number;
  output: string;              // truncated stdout/stderr (cap 64KB)
  evidenceId?: string;         // set on Day 17 (evidence storage)
}

export interface VerificationCheck {
  readonly kind: CheckKind;
  readonly timeoutMs: number;  // per-check timeout (level 1)
  run(ctx: CheckContext): Promise<CheckResult>;
}

export interface CheckContext {
  changeId: string;
  worktreePath: string;        // agent's dedicated branch/worktree (never main checkout)
  sandboxRoot: string;
}
```

### 2.2 Request-level orchestration (two timeout levels)

```ts
export class VerificationEngine {
  private readonly checks: VerificationCheck[];           // registry, Phase 1 = [CompileCheck] (+TestCheck Day 16)
  private readonly requestTimeoutMs = env('VERIFY_REQUEST_TIMEOUT_MS', 120_000); // level 2 — matches Day-09 VERIFY step timeout

  async verify(changeId: string): Promise<VerificationReport> {
    const ctx = await this.buildContext(changeId);        // resolve worktree for change
    const started = Date.now();
    // Phase 1 strategy: FULL (all checks) + PARALLEL (Promise.all)
    const results = await withTimeout(
      Promise.all(this.checks.map(c => withTimeout(c.run(ctx), c.timeoutMs, 'CHECK_TIMEOUT'))),
      this.requestTimeoutMs, 'REQUEST_TIMEOUT',
    ).catch(err => this.timeoutReport(changeId, err));    // request timeout → all unfinished checks TIMED_OUT
    const report = buildReport(changeId, results, Date.now() - started);
    await this.persist(report);                            // verification_reports + verification_check_results
    this.bus.publish(makeEvent('verification.completed', {
      changeId, taskId: report.taskId,
      result: report.overall,                              // PASSED | FAILED
      reportId: report.id,
    }));
    return report;
  }
}
```

- **Overall result:** `PASSED` iff every check `PASSED` (FLAKY/TIMED_OUT count as not-passed; Day-16 retry-once converts FLAKY→PASSED or leaves FLAKY).
- **Task transition:** on PASSED the VERIFY `StepHandler` lets WorkflowRunner continue (task → AWAITING_REVIEW); on FAILED, the handler returns `{ ok: false, failureClass: 'PERMANENT', retriable: false }` → workflow marks verification failed → task → REWORK (per Day-06 transition table) with the report attached.

### 2.3 CompileCheck (in-process, dedicated worktree)

```ts
export class CompileCheck implements VerificationCheck {
  readonly kind = 'COMPILE';
  readonly timeoutMs = env('VERIFY_COMPILE_TIMEOUT_MS', 60_000);

  async run(ctx: CheckContext): Promise<CheckResult> {
    const t0 = Date.now();
    const proc = spawn('pnpm', ['exec', 'tsc', '--noEmit', '-p', ctx.worktreePath], {
      cwd: ctx.worktreePath, env: sanitizedEnv(),
    });
    const { code, out } = await collectOutput(proc, 64 * 1024);
    return {
      checkKind: 'COMPILE',
      status: code === 0 ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t0,
      output: out,
    };
  }
}
```

**Spec §5.5 fix applied:** checks run **in-process on the agent's dedicated branch/worktree** — Phase 1 does not use containers. The worktree path comes from `agent_runs.worktree_path` (join via change → task → latest run). `sanitizedEnv()` strips secrets (no `ANTHROPIC_API_KEY` in child env).

### 2.4 Tables (migration `0015_verification.sql`)

```sql
CREATE TABLE verification_reports (
  id           TEXT PRIMARY KEY,
  change_id    TEXT NOT NULL REFERENCES changes(id),
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  overall      TEXT NOT NULL CHECK (overall IN ('PASSED','FAILED')),
  duration_ms  INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE verification_check_results (
  id           TEXT PRIMARY KEY,
  report_id    TEXT NOT NULL REFERENCES verification_reports(id),
  check_kind   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('PASSED','FAILED','FLAKY','TIMED_OUT','SKIPPED')),
  duration_ms  INTEGER NOT NULL,
  output       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.5 VERIFY StepHandler wiring (replaces Day-09 stub)

```ts
// apps/api/src/bootstrap.ts
registry.set('VERIFY', async (stepCtx) => {
  const changeId = await findChangeId(db, stepCtx.taskId, stepCtx.attemptNumber);
  const report = await verificationEngine.verify(changeId);
  return report.overall === 'PASSED'
    ? { ok: true, output: { reportId: report.id } }
    : { ok: false, error: `verification failed: ${report.failedChecks.join(',')}`,
        failureClass: 'PERMANENT', retriable: false };
});
```

No `verification.completed` on REPORT-level timeout until the catch builds a TIMED_OUT report — ensure the catch path also persists + publishes so Day-14 subscriber + Day-27 observability always see a report.

---

## 3. Tasks

- [ ] **3.1** Scaffold `packages/verification-engine` (package.json `@harness/verification-engine`, deps: domain/event-bus/db/di only — R4). (30 min)
- [ ] **3.2** Migration `0015_verification.sql` + Drizzle schema. (45 min)
- [ ] **3.3** Types + `VerificationCheck` registry + `buildReport`. (1 h)
- [ ] **3.4** `VerificationEngine.verify` with two-level timeouts + persist + publish. (1.5 h)
- [ ] **3.5** `CompileCheck` (spawn tsc in worktree, output cap, sanitized env). (1 h)
- [ ] **3.6** Replace VERIFY stub in bootstrap; update wiring-map. (30 min)
- [ ] **3.7** Tests: passing compile → PASSED + `verification.completed` → change VERIFIED (Day-14 subscriber, end-to-end); failing fixture → FAILED → task REWORK; per-check timeout → TIMED_OUT; request timeout → partial results TIMED_OUT; child env has no secrets. (1.5 h)

---

## 4. Deliverables

| File | Description |
|---|---|
| `packages/verification-engine/src/verification-engine.ts` | Orchestrator: full/parallel, two-level timeout, persist + publish |
| `packages/verification-engine/src/checks/compile-check.ts` | `tsc --noEmit` in agent worktree |
| `packages/verification-engine/src/types.ts` | CheckKind/CheckStatus/VerificationCheck/CheckContext |
| `packages/verification-engine/migrations/0015_verification.sql` | reports + check results tables |
| `fixtures/compile-fail/` | Fixture project that fails tsc |
| `apps/api/src/bootstrap.ts` (edit) | VERIFY handler wired to engine |

---

## 5. Acceptance Criteria

- [ ] Passing change → report PASSED → `verification.completed` → change+artifacts flip to VERIFIED (integration test with real subscriber chain).
- [ ] Failing change → report FAILED → task → REWORK with report linked in `task_state_history` metadata.
- [ ] Per-check timeout produces TIMED_OUT result, does not hang the request; request-level timeout caps total wall time.
- [ ] Check process environment contains no `ANTHROPIC_API_KEY` (assert in test).
- [ ] Boundary tests still pass (verification-engine imports only domain/event-bus/db/di).
- [ ] `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Worktree resolution can fail** (change exists but its run's worktree was cleaned). Treat as check-infra error → `SKIPPED` + `task → AWAITING_HUMAN_INTERVENTION` rather than a fake FAILED.
- **Output size:** tsc can emit megabytes on a broken workspace — cap at 64KB and mark truncation in `output` (`...[truncated]`); full output can live in evidence storage (Day 17).
- **Parallel checks share the worktree:** checks must be read-only (compile/lint) or use isolated subdirs (tests Day 16) — never let two checks mutate the same files concurrently.
- **`pnpm exec tsc` needs node_modules in the worktree** — document that worktrees share the repo's install (symlink or `pnpm install` at worktree creation in Day-12 runtime setup); smoke-test this path.
- **Next:** [Day 16 — Test Executor, Timeouts & Flaky Handling](day-16.md) adds TestCheck with the spec's retry-once → FLAKY rule.

---

*Prev: [Day 14 — Artifact Tracker Phase 1 & Week 2 Checkpoint](day-14.md) | Next: [Day 16 — Test Executor, Timeouts & Flaky Handling](day-16.md)*
