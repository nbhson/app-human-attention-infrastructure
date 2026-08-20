# Day 27 — Benchmark Runtime: Minimal Benchmark Harness Container (bash + editor)

| | |
|---|---|
| **Week** | 6 — Benchmark + judge |
| **Spec refs** | Spec 11 §5.1–5.2 (benchmark corpus + Minimal Benchmark Harness: bash + editor only, minimal deps) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 26 (benchmark corpus — frozen gold labels) |

---

## 1. Objectives

By end of day you will have:

1. A **Minimal Benchmark Harness (MBH)** — a container image exposing only **bash + the editor/CLI tools** HAI itself uses, with no extra dependencies that could inflate or distort a score (Spec 11 §5.2).
2. A **benchmark run driver** in `@harness/benchmark` that executes a `BenchTask` end-to-end **through HAI's real pipeline** (Spec 11 §5.2: "a score measures HAI's real pipeline"), not a stubbed agent.
3. **Deterministic, sandboxed execution**: each task runs from `baseCommit` in the container, applies I/O only inside the sandbox, and returns a `BenchRunResult` (patch, test output, provenance).
4. **Isolation between HAI-as-system and HAI-as-code-under-test** — the harness scores the *system*, not the fixtures.

This is the execution half of the benchmark: an environment where a frozen task, run through the real pipeline, produces a comparable result.

---

## 2. Design Decisions

### 2.1 MBH container — minimal, not convenient

Spec 11 §5.2 is explicit: the container has **only bash + editor tools** plus the runtime HAI genuinely needs. Every extra package is a place a score can be gamed or a task can behave differently than in production:

```
FROM a-base-image-with: bash, git, the target language toolchain, curl
# NO: pytest plugins, formatting daemons, linters, or "helpful" dev tools the agent didn't ask for
```

The benchmark must reproduce the *production* tool surface, not a friendlier one.

### 2.2 Run driver + result record

```typescript
// packages/benchmark/src/runtime.ts
export interface BenchRun {
  id: string;
  taskId: string;                // → BenchTask (Day 26)
  corpusVersion: string;         // pinned
  pipeline: 'hai';               // the real pipeline, not a stub
  startCommit: string;           // == task.baseCommit
  endCommit?: string;
  producedPatch: string;
  testOutput: string;            // raw gold-test results
  passed: boolean;               // gold tests all green
  metadata: BenchRunMetadata;    // wall time, tokens, tool-call count, container id
  finishedAt: Date;
}
```

`passed` is computed **mechanically** from gold-test output — the judge (Day 28) scores *quality*; the runtime only records *did the gold tests pass*. Keep those separate so a runtime can never "re-score" correctness away.

### 2.3 Execute *through the real pipeline*

The agent under test is not a MockLLM. `pipeline: 'hai'` means: route the task's `problemStatement` into the actual orchestrator (Context → Agent → Verify → Review), with the human gate **suspended only for AUTO_APPROVABLE tasks** — and even then, only inside the sampling-audited path (Architecture §4.2).

For `HUMAN_ROUTED` tasks the run stops at the review queue with a proposed patch; the benchmark scores the *proposed* patch against gold. A score never auto-approves a `HUMAN_ROUTED` task — that's the invariant, exercised exactly as in production.

### 2.4 Determinism + sandbox boundary

- Runs are pinned to `baseCommit` and a frozen toolchain image tag; the same task twice yields comparable results.
- All file I/O stays in the sandbox; the harness never mutates the repo or a shared DB.
- The `goldPatch` is only ever applied for **label verification**, never revealed to the agent during a run.

### 2.5 Boundary

`@harness/benchmark` stays on the four allowed imports. The run driver talks to the orchestrator **through `IEventBus`/the existing HTTP seam**, not by importing `@harness/orchestrator` directly — the benchmark is an external scorer of the system, not a library client.

---

## 3. Tasks

### 3.1 MBH image + `Dockerfile` (120 min)

- [ ] Minimal image: bash, editor/git, required toolchain; no luxuries (§2.1).
- [ ] Tag + version (pinned) so runs are reproducible; document the tag in `README`.

### 3.2 Sandbox exec adapter (90 min)

- [ ] `containers/benchmark-exec.ts` — start container, mount task fixture, exec bash commands; enforce I/O stays in sandbox.
- [ ] Reuse Phase 2 sandbox infra (object-store + sandbox) — no bespoke exec path.

### 3.3 `BenchRun` model + `runtime.ts` (120 min)

- [ ] `BenchRun`, `BenchRunMetadata` (§2.2); schema `bench_runs` + migration.
- [ ] `BenchmarkRuntime.run(task)` — spawn MBH from `baseCommit`, drive real pipeline, collect patch + gold-test output.

### 3.4 Gold-test adjudication (90 min)

- [ ] Run `goldTests` in-container; compute `passed` mechanically from exit codes/output; record raw `testOutput`.

### 3.5 Determinism + isolation tests (120 min)

- [ ] Same task, no code change → same `passed` (and comparable token/tool counts); a run never exposes `goldPatch`.
- [ ] Verify `HUMAN_ROUTED` runs halt at the review queue with a proposed patch (no auto-approve); `AUTO_APPROVABLE` only advances via the sampling-audited path.
- [ ] Sandbox I/O cannot escape (write outside fixture rejects).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/benchmark/src/runtime.ts` | `BenchmarkRuntime`, `BenchRun` |
| `packages/db/src/schema/benchmark.ts` (updated) | `bench_runs` table |
| `containers/benchmark-exec.ts` | Sandbox exec adapter |
| `containers/mbh.Dockerfile` | Minimal Benchmark Harness image |
| `packages/benchmark/src/__tests__/runtime.test.ts` | Adjudication + isolation tests |

---

## 5. Acceptance Criteria

- [ ] MBH container exposes only bash + editor + required toolchain (documented; no luxury deps).
- [ ] `BenchmarkRuntime.run` executes a frozen task end-to-end **through the real pipeline** (not MockLLM).
- [ ] `passed` is computed mechanically from gold-test output; raw `testOutput` recorded.
- [ ] `HUMAN_ROUTED` runs halt at the review queue (proposed patch, no auto-approve).
- [ ] `AUTO_APPROVABLE` advancement occurs only via the sampling-audited path (Architecture §4.2).
- [ ] Same-task re-run is deterministic; run cannot see `goldPatch`.
- [ ] Sandbox I/O cannot escape the fixture.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **The container is minimal on purpose.** Spec 11 §5.2 calls it the *Minimal* Benchmark Harness for a reason: extra tools are a hidden score variable. A task that passes only because the image ships a plugin the agent never used in production is a false pass.
- **Score the *proposed patch*, not a forced approval.** For `HUMAN_ROUTED` tasks the benchmark compares the agent's proposed patch to gold. Forcing the human gate open to get a result would score a pipeline that never actually exists in production.
- **Mechanics of pass/guilty are the runtime's, quality is the judge's.** Keep `passed` (gold tests) and the judge's rubric (Day 28) as separate layers; conflating them is how a runtime silently re-defines "correct."
- **Determinism is the comparability contract.** If two runs of the same task differ, every later A/B and calibration signal is noise. Pin the image, the base commit, and the task — then verify with a repeat-run test.
- **The benchmark measures HAI-the-system, not HAI-as-a-library.** The driver must go through the same seam a real task uses (event bus / HTTP). Importing the orchestrator as a library would benchmark a different, friendlier object.
- **Tomorrow (Day 28):** LLM-as-judge — rubric-scored behind `LLMProvider`, audited (Spec 11 §5.1).

---

*Prev: [Day 26 — Benchmark Corpus: Versioned Gold Labels (SWE-bench-style Tasks)](day-26.md) | Next: [Day 28 — LLM-as-Judge: Rubric-Scored Behind `LLMProvider`, Audited](day-28.md)*
