# Known Phase-1 Limitations

> **Read this before you scale, shard, or "fix" something that looks like a bug.**
> These are deliberate Phase-1 boundaries. Each one is either fixed on a
> scheduled day, or deliberately out of scope until a later phase. If you hit a
> wall described here, the wall is the design — don't fight it in the code.

> **`review-reorient` (v0.6) — obsolete items.** §3 (the startup reconciler) and
> the agent-file-tools half of §4 are **retired**: the dispatcher/runtime loops
> went with code-gen, so there is no `EXECUTING`/`VERIFYING` stranding to repair
> and no `read_file`/`write_file`/`list_directory` agent tools. Verification is
> now container-isolated (`@harness/sandbox` → `DockerSandbox`), as §4 previewed.

## 1. Single node, single process, single database

The entire harness runs as **one** API process against **one** Postgres. There is
no leader election, no replica failover, no connection to a message broker.

- Every concurrency guarantee — `FOR UPDATE SKIP LOCKED`, optimistic locks
  (`WHERE state = from`), guarded `UPDATE ... WHERE status = 'QUEUED'`, unique
  idempotency keys — was written and tested against a **single shared database**.
  They race *correctly* when two loops or two reviewers contend on the same row
  (`apps/api/test/concurrency/`, `packages/db/src/faults.ts`), but they assume
  one DB, not a cluster.
- **Network partitions / split-brain are non-issues**: with one node and one DB,
  there is no second writer to disagree with.
- Scaling beyond one process is not scheduled anywhere in the plan; treat it as
  out of scope until it has a ticket of its own.

## 2. No backpressure, no queue shedding

`IEventBus` is an **in-process, in-memory** bus (`InProcessEventBus`); subscribers
run synchronously off the publishing call. The load smoke test (§2.3) pushes 50
tasks as the ceiling — that is the *tested* envelope, not a benchmark or an SLA.

- There is no rate limiting, no dead-letter queue, and no durable buffer. If the
  process dies mid-publish, the event is gone (its side-effect may or may not have
  committed, which is exactly what the reconciler in §3 exists to catch).
- A durable queue behind the same `IEventBus` contract (no subscriber changes) is
  scheduled: **Phase 3, Day 34 — Durable Queue (Redis/SQS)**.

## 3. The reconciler is the *only* sanctioned auto-repair

On a non-graceful crash (`SIGKILL`, not `SIGTERM`), a task can be stranded in
`EXECUTING` or `VERIFYING`. One thing — and *only* one thing — repairs that:

- `apps/api/src/reconcile.ts`'s `reconcileOrphans()` runs **once at startup,
  before the dispatcher or runtime loop starts** (`apps/api/src/index.ts`). This
  is a single-writer moment, so it may act safely.
- It moves each orphaned `EXECUTING`/`VERIFYING` task to
  `AWAITING_HUMAN_INTERVENTION` with reason `PROCESS_DIED`, and publishes
  `task.orphan_recovered` (see the audit cookbook, Q9).
- It **never** re-runs, re-queues, or decides anything. It escorts the task to a
  human. The Q8 orphan detector stays a **smoke alarm, not a fixer** — do not
  auto-repair from a cron; only the startup reconciler may act, and only here.

## 4. One shared sandbox; verification runs on the host

The agent's three file tools (`read_file`/`write_file`/`list_directory`) are all
bound to **one global `SANDBOX_ROOT`** (set in `bootstrap.ts`). Verification is
not containerised: `CompileCheck` (Day 15) and `TestCheck` (Day 16) spawn `tsc`
and `vitest` as child processes on the **host**, inheriting its filesystem.

- **Concurrent execution is not exercised**: two workers verifying over the same
  tree would race on `tsc`/`vitest` output files, so the load smoke runs 2
  dispatchers + 2 runtime loops for the *dispatch* path but drives the
  failure/retry scenarios sequentially. It is safe to race *dispatch* and *queuing*
  — not two in-flight verifications of the same tree.
- A bare worktree still "passes" Vitest via `--passWithNoTests`; a suite that
  must *actually* run needs its own `vitest.config.ts` so it doesn't report
  "no tests" and pass vacuously (see the Day-26 S3 fixture).
- Container sandboxing lands in **Phase 2, Day 22** (verification) and **Day 23**
  (agent code mode).

## 5. Deterministic fault injection only (no chaos)

Failure-injection tests (`FaultyDb` + the F1–F5 suite) throw a *queued* error at
the head of the next matching query — deterministic, reproducible, no real network
failure or Postgres restart. Deliberately **no** chaos-monkey random faults:
reproducibility beats coverage when the point is to pin a single invariant.

## 6. Performance numbers are not SLAs

The load smoke reports p50/p95 durations and wall-clock, but these are **observations,
not guarantees**. Tuning against them before a real workload exists is how Phase-1
projects die. A "performance baseline" item belongs on the Day-30 backlog — not a
tuning sprint now.