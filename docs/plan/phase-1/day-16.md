# Day 16 — Test Executor, Timeouts & Flaky Handling

| | |
|---|---|
| **Week** | 3 — Trust Pipeline |
| **Spec refs** | Spec 7 §5.6 (Flaky), §5.7 (Timeout Levels) — v0.1, updated |
| **Estimated effort** | 6 h |
| **Prerequisites** | Day 15 (VerificationEngine, CheckContext, two-level timeouts) |

---

## 1. Objectives

1. Add **TestCheck** to the verification registry: run the worktree's Vitest suite and parse structured results.
2. Implement the spec's **flaky rule** (§5.6): a failed test run is retried **once**; pass-on-retry → `FLAKY` (counts as passed-but-flagged), fail-again → `FAILED`.
3. Parse Vitest **JSON reporter** output into per-test results stored in `verification_test_results`.
4. Enforce timeout semantics precisely: per-check timeout (level 1) kills the test process group; request-level timeout (level 2) marks unfinished checks `TIMED_OUT`.
5. Surface flaky tests as first-class data for the Attention Engine (Day 18–19: flakiness raises risk/novelty).

> **Why this matters:** "tests pass" is the single most-claimed, least-evidenced statement agents make. Today turns it into structured, stored, re-checkable evidence — and stops one flaky test from silently eroding trust in the whole report.

---

## 2. Design Decisions

### 2.1 TestCheck with JSON reporter

```ts
// packages/verification-engine/src/checks/test-check.ts
export class TestCheck implements VerificationCheck {
  readonly kind = 'TEST';
  readonly timeoutMs = env('VERIFY_TEST_TIMEOUT_MS', 90_000);   // level 1, < request-level 120s

  constructor(private readonly db: Db) {}

  async run(ctx: CheckContext): Promise<CheckResult> {
    const t0 = Date.now();
    const first = await this.runVitest(ctx);
    if (first.exitCode === 0) {
      await this.persistResults(ctx, first, 'PASSED');
      return { checkKind: 'TEST', status: 'PASSED', durationMs: Date.now() - t0, output: first.summary };
    }
    // §5.6 flaky rule: retry ONCE
    const second = await this.runVitest(ctx);
    const flaky = second.exitCode === 0;
    await this.persistResults(ctx, flaky ? second : first, flaky ? 'FLAKY' : 'FAILED', { retried: true });
    return {
      checkKind: 'TEST',
      status: flaky ? 'FLAKY' : 'FAILED',
      durationMs: Date.now() - t0,
      output: (flaky ? second : first).summary,
    };
  }

  private async runVitest(ctx: CheckContext): Promise<VitestRun> {
    const proc = spawn('pnpm', ['exec', 'vitest', 'run', '--reporter=json',
      '--outputFile', `${ctx.worktreePath}/.vitest-out.json`],
      { cwd: ctx.worktreePath, env: sanitizedEnv(), detached: true });  // detached: own process group
    return collectJsonResult(proc, `${ctx.worktreePath}/.vitest-out.json`, this.timeoutMs);
  }
}
```

**Process-group kill:** `detached: true` + `process.kill(-proc.pid, 'SIGKILL')` on timeout — Vitest spawns workers; killing only the parent leaks them (classic hang-the-API bug).

### 2.2 Flaky semantics (exact)

| First run | Retry | Stored status | Overall report impact |
|---|---|---|---|
| pass | — | `PASSED` | passed |
| fail | pass | `FLAKY` | passed-but-flagged (report.overall stays PASSED, `report.flaky = true`) |
| fail | fail | `FAILED` | failed |

- `buildReport` (Day 15) updated: overall = PASSED iff every check ∈ {PASSED, FLAKY}; `flaky` flag set if any check FLAKY.
- FLAKY check results feed Attention Engine risk factor (Day 18) — **never silently treated as PASSED downstream.**

### 2.3 Table (migration `0016_test_results.sql`)

```sql
CREATE TABLE verification_test_results (
  id            TEXT PRIMARY KEY,
  check_result_id TEXT NOT NULL REFERENCES verification_check_results(id),
  test_file     TEXT NOT NULL,
  test_name     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('PASSED','FAILED','SKIPPED')),
  duration_ms   INTEGER NOT NULL,
  error         TEXT,                       -- failure message + stack (truncated 8KB)
  was_retried   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE verification_reports
  ADD COLUMN IF NOT EXISTS flaky BOOLEAN NOT NULL DEFAULT false;
```

### 2.4 Vitest JSON parsing (pure, fixture-tested)

```ts
// packages/verification-engine/src/parse-vitest-json.ts
export function parseVitestJson(raw: string): ParsedTestResult[] {
  const doc = JSON.parse(raw) as VitestJsonReport;
  return doc.testResults.flatMap(f =>
    f.assertionResults.map(a => ({
      testFile: f.name, testName: a.fullName,
      status: a.status === 'passed' ? 'PASSED' : a.status === 'failed' ? 'FAILED' : 'SKIPPED',
      durationMs: a.duration ?? 0,
      error: a.failureMessages?.join('\n').slice(0, 8192),
    })));
}
```

Fixture: capture real `vitest --reporter=json` output from `fixtures/` (one passing suite, one failing suite, one with skipped tests) → parser unit tests never invoke Vitest itself.

### 2.5 Timeout test matrix (the heart of today)

| Scenario | Expected |
|---|---|
| Suite finishes < timeout | result parsed, PASSED/FAILED/FLAKY per §2.2 |
| Suite exceeds level-1 timeout | process group killed, result `TIMED_OUT`, no leaked workers (assert no `vitest` in `ps`) |
| Compile slow + test slow, sum > level-2 | unfinished checks `TIMED_OUT`, report persisted anyway |
| Retry also hangs | one level-1 timeout each; total ≤ 2×90s, then `TIMED_OUT` (no third run) |

---

## 3. Tasks

- [ ] **3.1** Migration `0016_test_results.sql` + Drizzle schema + `flaky` column. (30 min)
- [ ] **3.2** `parseVitestJson` + fixtures + unit tests. (1 h)
- [ ] **3.3** `TestCheck` with retry-once + process-group kill + `persistResults`. (1.5 h)
- [ ] **3.4** Update `buildReport` for FLAKY semantics; register TestCheck in engine + bootstrap. (45 min)
- [ ] **3.5** Integration: fixture worktree with 1 failing test → FAILED → REWORK; flaky fixture (fails once via counter file) → FLAKY → report PASSED + `flaky: true`. (1 h)
- [ ] **3.6** Timeout matrix tests incl. process-leak assertion. (1 h)
- [ ] **3.7** Doc: append "flaky test policy" section to `docs/architecture/wiring-map.md` (or short ADR). (15 min)

---

## 4. Deliverables

| File | Description |
|---|---|
| `packages/verification-engine/src/checks/test-check.ts` | Vitest runner + retry-once flaky rule |
| `packages/verification-engine/src/parse-vitest-json.ts` | Pure JSON-reporter parser |
| `packages/verification-engine/migrations/0016_test_results.sql` | per-test results + report.flaky |
| `fixtures/vitest-json/{pass,fail,skip}.json` | Parser fixtures |
| `fixtures/flaky-counter/` | Suite that fails on first run only (counter file) |

---

## 5. Acceptance Criteria

- [ ] Failing suite → FAILED, per-test rows stored with error text, task → REWORK.
- [ ] Flaky suite (fail→pass) → check FLAKY, report PASSED with `flaky: true`, `was_retried` rows present.
- [ ] Level-1 timeout kills the whole process group (no leaked vitest workers — asserted in test).
- [ ] Level-2 timeout persists a report with TIMED_OUT checks (never a missing report).
- [ ] No third execution ever occurs (assert vitest invoked exactly 2× on persistent failure).
- [ ] `pnpm test && pnpm lint` green; boundary tests green.

---

## 6. Notes & Pitfalls

- **Flaky fixture design:** use a counter file in tmp (first invocation exits 1, second 0) — deterministic, no sleeps. Reset it in test setup.
- **`--reporter=json` writes to stdout by default** — always use `--outputFile` so human-readable noise doesn't corrupt parsing; parse the file, keep stdout for the 64KB `output` field.
- **Retry doubles wall time:** 2×90s test + 60s compile can exceed the 120s level-2 timeout — that's why levels are nested; verify the request timeout fires correctly in the matrix test instead of bumping limits blindly.
- **DB writes after kill:** if the process was killed, `.vitest-out.json` may be absent/partial — parser must return `[]` + a parse-error note, never throw into the engine.
- **Next:** [Day 17 — Evidence Storage, Provenance Linking & Diff Engine](day-17.md) gives every check result a durable, queryable evidence trail.

---

*Prev: [Day 15 — Verification Engine: Request Handler & Compile Check](day-15.md) | Next: [Day 17 — Evidence Storage, Provenance Linking & Diff Engine](day-17.md)*
