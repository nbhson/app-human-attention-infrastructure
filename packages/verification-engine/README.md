# @harness/verification-engine — Compile, Test, Sandboxed & Targeted Checks

The independent, machine-side gate each change must pass before it can reach a
human. Runs compile, test, and sandboxed checks — in isolation, with timeouts,
with evidence attached — plus the clone-and-test and targeted-verification
paths.

**Status:** complete (as-built) ·
**Boundary rule:** engine (R4) — imports only shared packages; resolves the `TOKENS.Sandbox`
seam, never a sibling engine's concrete (never `agent-runtime`, never `code-index`).

---

## Purpose

1. **Verify independently of the AI** — the reviewer never checks its own work.
2. **Run ordered checks** — `COMPILE` → `TEST` → sandboxed check, fail-closed.
3. **Bound every check** — per-check timeout; read-only over the worktree.
4. **Attach evidence, not just a verdict** — store the failing output, not "tests failed".
5. **Emit one aggregate report** — `PASSED` iff every check passed (or is flaky).
6. **Verify the real PR clone** — clone the PR head into the sandbox worktree, run its
   own `build`/`test` scripts in Docker (`CloneVerifier`).
7. **Target the affected set** — run the transitive affected-test closure when the
   dependency graph is complete, else the full suite (`TargetedVerifier`).
8. **Flag, never gate** — a FAILED clone surfaces as an in-report flag via
   `flagReport`/`renderFlag`.

## Execution models

```text
   (a) in-process change check                          (b) clone-and-test
   CompileCheck ──▶ TestCheck ──▶ SandboxedCheck |      cloneAndCheckout → CloneVerifier
                   aggregate → VerificationReport         COMPILE(package scripts) → TEST  → flags
```

Fail-closed ordering (both paths): a compile failure short-circuits before tests.
In the clone path (`clone-checks/*`), a non-passing COMPILE short-circuits TEST to
`SKIPPED`; the package scripts are discovered by `parsePackageScripts` /
`resolvePackageScripts` and run in the Docker sandbox by `SandboxRunner`.

Manifest discovery covers repos whose `package.json` lives one level down
(`ClientApp/`, `frontend/`, `apps/web`, …) with no root manifest: root is tried
first, then each one-level child (sorted, skipping `node_modules`/dot dirs);
the first manifest declaring `build`/`test` wins and the runner `cd`s into its
`subdir` via `sh -lc` (the pinned `node:20-alpine` image has no `bash`). Only
the literal script *name* (`<pm> run build`) is executed, never the body;
the package manager comes from the lockfile next to the manifest
(`pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, else `npm`). Anything deeper
than one level must be wired explicitly, not guessed.

Before build/test, the runner installs `node_modules` when missing
(`ensureInstalled`, on by default, off via `VERIFY_INSTALL_DEPS=0`): a frozen
install (`npm ci` / `corepack pnpm|yarn install --frozen-lockfile`) when a
lockfile is present, plain `install` otherwise. The install runs in its own
container with `network: 'bridge'` (registry egress for that step only, caches
redirected to `/tmp` because the rootfs is read-only); build/test stay on
`network: 'none'`. An install failure records FAILED with the `[deps]`-tagged
log, never a silent skip. Container exit `127` without a Docker image/pull
message is the program's own "command not found" (missing toolchain or
`node_modules/.bin`), so it is a FAILED result with evidence — only `125`/`126`
and `127`-with-docker-message are `SandboxInfraError` (→ SKIPPED).

Resource sizing for real-world clones: the install container gets `network:
'bridge'` plus a `1g` `/tmp` tmpfs (a cold npm cache for a large app is
hundreds of MB — the 64m build default dies `ENOSPC`); build/test keep the
small tmpfs but run with `--max-old-space-size` at 3/4 of the container memory
limit (`heapMbForMemory`), and the clone path defaults to `4g` — an
Angular-class `ng build` peaks past 1 GB of heap and OOMs at 512m.

## Check contract

The **check abstraction** is the plug-in point every check shares. A check is a
read-only operation over the worktree returning a `CheckResult`; the engine owns
timeouts, aggregation, persistence, and event publication — checks never do.

| Concept                   | Values                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `CheckKind`               | `COMPILE`, `TEST`, `LINT`                                                                                           |
| `CheckStatus` (per check) | `PASSED`, `FAILED`, `FLAKY`, `TIMED_OUT`, `SKIPPED`                                                                 |
| `OverallVerdict`          | `PASSED` iff every check `PASSED` or `FLAKY`                                                                        |
| `ParsedTestResult`        | Per-test leaf (`testFile`, `testName`, status, `durationMs`, truncated `error`)                                     |
| `VerificationReport`      | `id`, `changeId`, `taskId`, `contentHash` (SHA-256 of verified bytes), `overall`, `checks`, `flaky`, `failedChecks` |

## Modules

| Module                                             | What it provides                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `verification-engine.ts`                           | Check orchestration: run in order, aggregate, persist, publish `verification.completed`. |
| `checks/compile-check.ts` / `checks/test-check.ts` | `CompileCheck` (`tsc --noEmit`), `TestCheck` (`vitest`, flaky retry).                    |
| `executors/sandboxed-check.ts`                     | `SandboxedCheck` — runs through `TOKENS.Sandbox`.                                        |
| `clone-verifier.ts`                                | `CloneVerifier` — COMPILE → TEST over a `CloneWorktree` in the Docker sandbox.           |
| `clone-checks/*`                                   | `CloneCompileCheck` / `CloneTestCheck` — package-script compile/test against the clone.  |
| `sandbox-runner.ts`                                | `SandboxRunner`, `parsePackageScripts`, `resolvePackageScripts` (+`subdir`), `detectPackageManager`, `runScriptCheck`. |
| `targeted-verifier.ts`                             | `TargetedVerifier` — affected set when complete, else the full suite.                    |
| `parse-vitest-json.ts`                             | Vitest JSON report → `ParsedTestResult[]`.                                               |
| `report-flag.ts` / `report-render.ts`              | `flagReport` / `renderFlag` — annotate (never gate) the report.                          |
| `evidence-store.ts`                                | Persist check output as `CHECK_OUTPUT` evidence.                                         |
| `env.ts`                                           | `sanitizedEnv` / `readInt` — sandbox env assembly (no leaked secrets).                   |
| `timeout.ts` / `types.ts`                          | per-check timeout; the shared check/status types.                                        |

## Interaction with other packages

```text
                     ┌─────────────────────┐
                     │ verification-engine │
                     └─────────┬───────────┘
            ┌──────────┬───────┴──────┬─────────────┐
            ▼          ▼              ▼             ▼
        @harness/   @harness/      @harness/     @harness/sandbox (seam)
        domain     event-bus         db        + @harness/code-index (via app host)
```

The engine does **not** import `agent-runtime` (generation) or `code-index` (the
graph leaf). The affected-set routing policy is `TargetedVerifier`; the app host
adapts `code-index`'s `affectedTests` onto the `AffectedTestsResolver` seam so the
engine never names a Git host or imports the graph.

## Key invariants

- **Isolation for all tooling.** Every check that shells out runs in a sandbox;
  the harness process never runs a change's code in-process.
- **Evidence, not just a verdict.** A failing check records _why_ it failed — that's
  what the reviewer sees.
- **Attributability.** `VerificationReport.contentHash` and the clone's `headSha`
  tie a report to an exact byte set.
- **Fail-closed, flag-don't-gate.** A failed check yields `overall: FAILED`; a
  failed clone is flagged in the report rather than blocking the review pipeline.
- **Targeted == full on a gap.** A targeted run that cannot prove a skipped test
  irrelevant falls back to the full suite.

## Directory structure

```
src/
├── index.ts
├── verification-engine.ts
├── checks/            # compile-check, test-check
├── executors/         # sandboxed-check
├── clone-verifier.ts
├── clone-checks/      # compile-check, test-check (package-script)
├── sandbox-runner.ts
├── targeted-verifier.ts
├── parse-vitest-json.ts
├── evidence-store.ts / env.ts / timeout.ts / report-flag.ts / report-render.ts
└── types.ts
```

## Public API surface

```typescript
// types: CheckKind, CheckStatus, OverallVerdict, ParsedTestResult, CheckResult,
//        CheckContext, VerificationCheck, VerificationReport
// engine: VerificationEngine
// checks: CompileCheck, TestCheck, SandboxedCheck, CloneCompileCheck, CloneTestCheck
// clone/targeted: CloneVerifier, CloneWorktree, CloneVerificationReport,
//                 TargetedVerifier, AffectedTestsResolver, TargetedRunResult
// sandbox: SandboxRunner, parsePackageScripts, resolvePackageScripts,
//          ResolvedPackageScripts, detectPackageManager, PackageManager, runScriptCheck
// flag/render: flagReport, renderFlag, FLAG_TAIL_LENGTH, FlaggedCheck, VerificationFlag
// helpers: parseVitestJson, evidence store, sanitizedEnv, timeout
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; the engine resolves `TOKENS.Sandbox`
(`DockerSandbox`) for sandboxed checks when `VERIFY_SANDBOX_ENABLED=1`. The
clone-and-test path is assembled in the app host (not a DI token) — see the wiring
map's "Verification breadth" section.
