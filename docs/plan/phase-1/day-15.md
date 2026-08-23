# Day 15 — Verification Engine: request handler + compile check (CompileCheck)

| | |
|---|---|
| **Week** | W3 — Trust pipeline |
| **Spec refs** | Spec 7 §1–2 (verification, CompileCheck), Spec 1 §3 (Claim ≠ Evidence) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 14 (review slice with a fresh PR diff in hand) |

---

## 1. Objectives

- Build `@harness/verification-engine` — the component that **independently** verifies a change the AI reviewed, so "the AI says it's fine" is never the only evidence.
- Implement the request handler + the first check: `CompileCheck` (runs `tsc --noEmit` against the change in the sandbox and parses compiler output into structured evidence).
- Emit `verification.completed` with a pass/fail verdict, exit code, and captured diagnostics, joined to the review's `correlation_id`.

## 2. Design Decisions

- Verification is **independent of the AI report**: the engine consumes the PR's diff/content, not the reviewer's opinion, so a bad review can be disproven by evidence.

```ts
export interface VerificationRequest {
  readonly changeId: ChangeID;     // or prUrl
  readonly correlationId: string;
  readonly checks: CheckKind[];    // ['COMPILE', ...]
}
export interface CheckResult {
  readonly kind: CheckKind;        // COMPILE | TEST
  readonly status: 'PASS' | 'FAIL' | 'ERROR' | 'TIMEOUT';
  readonly exitCode?: number;
  readonly diagnostics: Diagnostic[];
  readonly durationMs: number;
}
```

- `CompileCheck` runs a real `tsc` subprocess against the sandbox export (fixtures in Phase 1 — container isolation is Phase 2+), parses stdout/stderr lines into `{file, line, severity, message}`.
- No AI, no git write, no test-run against a paid service; the engine only *observes* and records evidence.

## 3. Tasks

### 3.1 Request handler + types (120 min)
- [ ] `request-handler.ts` — enqueue/dispatch a `VerificationRequest`
- [ ] `verification.ts` types — `CheckResult`, `Diagnostic`, `CheckKind`, statuses

### 3.2 CompileCheck (180 min)
- [ ] `checks/compile-check.ts` — spawn `tsc --noEmit`, parse output, timeout
- [ ] `checks/tsc-parser.ts` — structured diagnostics from compiler text

### 3.3 Events + tests (120 min)
- [ ] Emit `verification.completed`; unit tests on a failing fixture + a passing fixture

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/verification-engine/src/request-handler.ts` | Verification dispatch |
| `packages/verification-engine/src/checks/compile-check.ts` | `CompileCheck` implementation |
| `packages/verification-engine/src/checks/tsc-parser.ts` | Compiler-output parser |
| `fixtures/verify/compile-fail/` | Fixture change that fails compile |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/verification-engine test` passes
- [ ] A failing fixture yields `status: FAIL` with line-level diagnostics; a passing fixture yields `PASS`
- [ ] `verification.completed` carries the same `correlation_id` as the review
- [ ] A `tsc` unavailable/timeout produces `ERROR`/`TIMEOUT`, not a crash

## 6. Notes & Pitfalls

- The engine's boundary rule holds: it imports only shared packages (never `agent-runtime`, `attention-engine`, etc.).
- Keep the check registry pluggable so `TestCheck` (Day 16) slots in as a new `CheckKind`, not a rewrite.

---

*Next: [Day 16 — Test executor, timeouts, flaky handling (TestCheck)](day-16.md)*