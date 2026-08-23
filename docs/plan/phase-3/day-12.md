# Day 12 — Run Build/Test in Docker Sandbox Against the Clone

| | |
|---|---|
| **Week** | 3 — Verification breadth |
| **Spec refs** | Spec 7 §5.5 + execution model (COMPILE→TEST); sandbox package; verification-engine check contract |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 11 (`cloneAndCheckout`); Phase-2 `@harness/sandbox` (Docker isolation) + `@harness/verification-engine` check seam |

---

## 1. Objectives

By end of day you will have:

1. A `SandboxVerifier` (or `Check`s) that runs **the cloned repo's own build + test** inside the Docker sandbox — `COMPILE` (build) then `TEST` (test runner), against the PR's clone, read-only over the harness.
2. The verification path consumes `CloneResult` from Day 11 and produces a `VerificationReport` (reusing the Phase-2 check contract: `CheckKind`/`CheckStatus`/`CheckResult`).
3. Timeouts per check, container teardown, and evidence capture of raw command output.
4. A stubbed-Docker test proving the right image + command sequence without a live sandbox in CI.

This is the *execute* step; Day 13 makes FAILED a report flag (not blocking) and stores evidence.

---

## 2. Design Decisions

### 2.1 Reuse the check contract, don't invent a second verifier

`@harness/verification-engine` already models `COMPILE`/`TEST` over a worktree. Extend it to run over a **clone worktree** (external PR) instead of the agent's own worktree — the check abstraction is already read-only and timed. No new engine seam.

### 2.2 `SandboxRunner` resolves the build command

The clone may be Node/TS (this repo's world) — resolve an explicit build/test command from the repo's own tooling (e.g. `package.json` scripts) or a configured override. Prefer running the PR's **declared** scripts (`build`/`test`) so we measure the PR, not a harness-invented command.

### 2.3 Isolation hardened per run

- Run in the Docker sandbox with its own network/file mount of the clone (read-write inside container, read-only host view after).
- Per-check wall-clock timeout; a hung test can't wedge the pipeline.
- Always teardown the container, even on timeout/panic (`finally`).

### 2.4 Ordering is fail-closed

`COMPILE` before `TEST` (a build failure short-circuits tests), mirroring Phase 1's `COMPILE → TEST` ordering.

---

## 3. Tasks

### 3.1 Extend check execution over clone (90 min)

- [ ] `compile-check` + `test-check` run against a `CloneResult` workdir; produce `CheckResult`s.

### 3.2 `SandboxRunner` (90 min)

- [ ] Resolve build/test commands from the clone's manifest (or override); run via `@harness/sandbox`; timeouts; teardown.

### 3.3 Report assembly (45 min)

- [ ] Aggregate `CheckResult[]` → `VerificationReport` (`overall` PASSED/FAILED, `failedChecks`).

### 3.4 Ingress wiring (60 min)

- [ ] After `fetchPullRequest`, clone + verify; emit `verification.completed` with the report.

### 3.5 Tests (75 min)

- [ ] Stubbed runner: correct command sequence; COMPILE failure short-circuits TEST; timeout → `TIMED_OUT`; teardown always runs.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/verification-engine/src/clone-checks/compile-check.ts` | COMPILE over clone |
| `packages/verification-engine/src/clone-checks/test-check.ts` | TEST over clone |
| `packages/verification-engine/src/sandbox-runner.ts` | Build/test command resolution + run |
| `packages/verification-engine/src/__tests__/clone-verify.test.ts` | Tests |

---

## 5. Acceptance Criteria

- [ ] A clone's own `build` + `test` run inside the Docker sandbox; `VerificationReport` aggregates them.
- [ ] COMPILE failure short-circuits TEST (fail-closed ordering).
- [ ] Per-check timeout → `TIMED_OUT`; hung check never wedges the pipeline.
- [ ] Container torn down on success, failure, and panic.
- [ ] Stubbed tests pass without a live sandbox.
- [ ] `pnpm --filter @harness/verification-engine test` green.

---

## 6. Notes & Pitfalls

- **Run the PR's scripts, not the harness's guesses.** If the manifest declares `test`, use it; a `"test": "echo ok"` PR is the PR's problem, surfaced honestly as evidence.
- **Teardown in `finally`.** Docker leaks (exit without `rm`) fill the sandbox host; the teardown-on-panic test exists to make that impossible.
- **Evidence = raw output.** Store stdout/stderr, not a summarised verdict — Day 13 turns evidence into the report's FAILED flag.
- **Day 13** — FAILED → flag in report (not blocking); evidence stored.

---

*Next: [Day 13 — FAILED → Flag in Report (Not Blocking); Evidence Stored](day-13.md)*