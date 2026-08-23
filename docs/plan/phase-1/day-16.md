# Day 16 — Test executor, timeouts, flaky handling (TestCheck)

| | |
|---|---|
| **Week** | W3 — Trust pipeline |
| **Spec refs** | Spec 7 §3 (test verification), Spec 1 §3 (evidence before confidence) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 15 (`CompileCheck` + check registry) |

---

## 1. Objectives

- Add `TestCheck` to the verification engine: run the change's test suite in the sandbox and produce structured pass/fail evidence.
- Implement hard **timeouts**, exit-code capture, and **flaky handling** (a run-level retry policy that classifies a flaky pass and records it honestly).
- Concurrency-guard the executor so multiple verification requests don't corrupt shared sandbox state.
- Emit `verification.completed` for TEST checks with per-case results and a stability marker (`stable` vs `flaky`).

## 2. Design Decisions

- `TestCheck` runs `pnpm test` (or the harness's runner) against the fixture change; a timeout is a distinct `TIMEOUT` status, never a silent hang.

```ts
// a flaky pass is still evidence, classified honestly
{ kind: 'TEST', status: 'PASS', flaky: true, attempts: 2,
  cases: [{ name, status: 'PASS' }, { name, status: 'FAIL' }] }
```

- Flaky handling is bounded (fixed max attempts per request, no unbounded retry loop — the retired code-gen retry taxonomy is not reintroduced). A result is recorded even when flaky, so confidence is measured on real evidence, not on a lucky-green run.

## 3. Tasks

### 3.1 TestCheck executor (180 min)
- [ ] `checks/test-check.ts` — run command, timeout, parse test output
- [ ] `executor.ts` — bounded-retry + flaky classification

### 3.2 Concurrency + isolation (120 min)
- [ ] Per-request workspace/venv isolation (fixture checkout copies)
- [ ] Semaphore limiting concurrent verification runs

### 3.3 Events + tests (120 min)
- [ ] `verification.completed` with cases + `flaky` flag; unit + integration tests (pass/fail/timeout/flaky fixtures)

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/verification-engine/src/checks/test-check.ts` | `TestCheck` implementation |
| `packages/verification-engine/src/executor.ts` | Bounded retry + flaky handling |
| `packages/verification-engine/src/isolation.ts` | Per-run sandbox isolation |
| `fixtures/verify/test-fail/` | Failing test fixture |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/verification-engine test` passes
- [ ] A hanging test run is stopped by timeout and reported `TIMEOUT`
- [ ] A flaky fixture is retried up to the bound and recorded with `flaky: true`
- [ ] Two concurrent verifications run against isolated workspaces without cross-contamination

## 6. Notes & Pitfalls

- Keep retry counts small and logged; the intent is *honest evidence*, not auto-fixing tests.
- Timeouts must kill the whole process tree, not just the shell wrapper.

---

*Next: [Day 17 — Evidence storage + provenance linking + diff engine](day-17.md)*