# @harness/verification-engine — Compile, Test & Sandboxed Checks

The independent, machine-side gate every executed change must pass before it can
reach a human. Runs compile, test, and sandboxed checks — in isolation, with
timeouts, and with the evidence attached.

**Status:** Phase 1 complete (as-built) ·
**Boundary rule:** engine (R4) — imports only shared packages; resolves `TOKENS.Sandbox`/`TOKENS.Runner` seams, never the concretes.

---

## Purpose

1. **Verify independently of the AI** — the agent never checks its own work.
2. **Run ordered checks** — `COMPILE` → `TEST` → sandboxed `LINT`/extra, fail-closed.
3. **Bound every check** — per-check timeout; read-only over the agent's worktree.
4. **Attach evidence, not just a verdict** — store the failing output, not "tests failed".
5. **Emit one aggregate report** — `PASSED` iff every check passed (or is flaky).

---

## Execution model

```text
                  Agent worktree (dedicated branch — never main)
                             │
                             ▼
     ┌─────────────────────────────────────────────┐
     │             Verification Engine              │
     │                                              │
     │  CompileCheck ──▶ TestCheck ──▶ SandboxedCheck│
     │      │               │                │       │
     │   (tsc --noEmit)  (vitest)      (isolated)   │
     └──────┴───────────────┴────────────────┴───────┘
                             │  aggregate
                             ▼
                    VerificationReport
                    overall: PASSED | FAILED
                    checks:  CheckResult[]
                    failedChecks: CheckKind[]
                             │
                             ▼
              verification.completed (event) → orchestrator
```

Fail-closed ordering: a compile failure short-circuits before tests; tests before
the sandboxed check — a later gate only runs when the earlier passes.

---

## Check contract

The **check abstraction** is the plug-in point every check shares. A check is a
read-only operation over the worktree returning a `CheckResult`; the engine owns
timeouts, aggregation, persistence, and event publication — checks never do.

| Concept | Values |
| --- | --- |
| `CheckKind` | `COMPILE`, `TEST`, `LINT` |
| `CheckStatus` (per check) | `PASSED`, `FAILED`, `FLAKY`, `TIMED_OUT`, `SKIPPED` |
| `OverallVerdict` | `PASSED` iff every check `PASSED` or `FLAKY` |
| `ParsedTestResult` | Per-test leaf (`testFile`, `testName`, `PASSED`/`FAILED`/`SKIPPED`, `durationMs`, optional truncated `error`) |
| `VerificationReport` | `id`, `changeId`, `taskId`, `contentHash` (SHA-256 of verified bytes), `overall`, `checks`, `flaky`, `failedChecks` |

---

## Modules

| Module | What it provides |
| --- | --- |
| `verification-engine.ts` | Check orchestration: run checks in order, aggregate, persist, publish `verification.completed`. |
| `checks/compile-check.ts` | `CompileCheck` — `tsc --noEmit`. |
| `checks/test-check.ts` | `TestCheck` — `vitest`, flaky retry. |
| `executors/sandboxed-check.ts` | `SandboxedCheck` (+ options) — runs through `TOKENS.Sandbox`. |
| `parse-vitest-json.ts` | Vitest JSON report → `ParsedTestResult[]`. |
| `evidence-store.ts` | Persist check output as `CHECK_OUTPUT` evidence. |
| `types.ts` | `CheckKind`, `CheckStatus`, `CheckResult`, `VerificationCheck`, `CheckContext`, `VerificationReport`. |
| `timeout.ts` | Per-check timeout enforcement. |
| `env.ts` | Sandbox env assembly (no leaked secrets). |

---

## Interaction with other packages

```text
                     ┌─────────────────────┐
                     │ verification-engine │
                     └─────────┬───────────┘
           ┌───────────┬───────┴──────┬────────────┐
           ▼           ▼              ▼            ▼
       @harness/    @harness/      @harness/    @harness/
       domain      event-bus         db        sandbox (seam)
```

The engine does **not** import `agent-runtime` or `sandbox` concretes — it
resolves `TOKENS.Sandbox` (for sandboxed checks) and `TOKENS.Runner` (for
anything generation-side) from the composition root. This keeps verification
genuinely independent of generation, not just a different call site.

---

## Key invariants

- **Isolation for all tooling.** Every check that shells out runs in a sandbox;
  the harness process never runs a change's code in-process.
- **Evidence, not just a verdict.** A failing check records *why* it failed
  (failing test, compile error) — that's what the reviewer sees.
- **Attributability.** `VerificationReport.contentHash` is the SHA-256 of the
  verified worktree bytes, tying a report to an exact change.
- **Fail-closed.** A failed check yields `overall: FAILED` and a `failedChecks`
  list that feeds the `REWORK` rationale.

---

## Directory structure

```
src/
├── index.ts
├── verification-engine.ts
├── checks/            # compile-check, test-check
├── executors/         # sandboxed-check
├── parse-vitest-json.ts
├── evidence-store.ts
├── env.ts
├── timeout.ts
└── types.ts
```

## Public API surface

```typescript
// types: CheckKind, CheckStatus, OverallVerdict, ParsedTestResult, CheckResult,
//        CheckContext, VerificationCheck, VerificationReport
// engine: VerificationEngine
// checks: CompileCheck, TestCheck, SandboxedCheck (+ SandboxedCheckOptions)
// helpers: parseVitestJson, evidence store, timeout, env
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; the verify transition is triggered
when a task reaches `VERIFYING`. Route surface is in `apps/api/src/routes`.