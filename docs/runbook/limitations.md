# Known Limitations

> **Read this before you scale, shard, or "fix" something that looks like a bug.**
> These are deliberate boundaries. Each one is either fixed on a
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
  They race _correctly_ when two loops or two reviewers contend on the same row
  (`apps/api/test/concurrency/`, `packages/db/src/faults.ts`), but they assume
  one DB, not a cluster.
- **Network partitions / split-brain are non-issues**: with one node and one DB,
  there is no second writer to disagree with.
- Scaling beyond one process is not scheduled anywhere in the plan; treat it as
  out of scope until it has a ticket of its own.

## 2. No backpressure, no queue shedding

`IEventBus` is an **in-process, in-memory** bus (`InProcessEventBus`); subscribers
run synchronously off the publishing call. The load smoke test (§2.3) pushes 50
tasks as the ceiling — that is the _tested_ envelope, not a benchmark or an SLA.

- There is no rate limiting, no dead-letter queue, and no durable buffer. If the
  process dies mid-publish, the event is gone (its side-effect may or may not have
  committed).
- A durable queue behind the same `IEventBus` contract (no subscriber changes) is
  available as `RedisEventsBus`, selected by `EVENT_TRANSPORT` (Day 34,
  **opt-in**; the in-process bus remains the default).

## 3. No startup reconciler (retired)

> **RETIRED in `review-reorient`.** This section is preserved as historical
> reference; the reconciler and the states it acted on (`EXECUTING`, `VERIFYING`)
> no longer exist in the live system.

On a non-graceful crash (`SIGKILL`, not `SIGTERM`), a task could previously be
stranded in `EXECUTING` or `VERIFYING`. One thing — and _only_ one thing —
repaired that:

- `apps/api/src/reconcile.ts`'s `reconcileOrphans()` ran **once at startup**,
  before the dispatcher or runtime loop started. This was a single-writer moment,
  so it could act safely.
- It moved each orphaned `EXECUTING`/`VERIFYING` task to
  `AWAITING_HUMAN_INTERVENTION` with reason `PROCESS_DIED`, and published
  `task.orphan_recovered` (see the audit cookbook, formerly Q9).
- It **never** re-ran, re-queued, or decided anything. It escorted the task to a
  human.

**Today:** the review slice creates a task and immediately cancels it
(`PENDING → CANCELLED`). There is no in-flight execution path, no dispatcher,
no runtime loop, and therefore no orphan state to recover. The `task.orphan_recovered`
event type remains in the domain vocabulary for backward compatibility with old
logs, but it is never published again.

If you see `EXECUTING`/`VERIFYING` rows in `task_state_history` today, they are
historical from pre-`review-reorient` runs.

## 4. Verification runs in the Docker sandbox

All verification (compile + test) runs inside the Docker sandbox
(`@harness/sandbox` → `DockerSandbox`). The clone's own `package.json` scripts
(`build`, `test`) are discovered and executed inside the container — not on the
host. The rootfs stays `--read-only`; the disposable surface is the throwaway
clone worktree itself.

- **Network is disabled** (`--network none`): the sandbox cannot reach out to
  package registries. Pre-installed dependencies are not supported; the clone's
  `node_modules` must already exist or the build will fail.
- **Resource caps** (`--cpus`, `--memory`, `--user 1000:1000`, `--cap-drop ALL`)
  keep each container safe even if the PR code tries to do something unexpected.
- **Timeout**: each container is killed after `VERIFY_SANDBOX_TIMEOUT_S` (default
  120s). A timed-out check is `TIMED_OUT`, not `FAILED`.

Container sandboxing landed on Day 22. Before that, `CompileCheck` / `TestCheck`
spun `tsc` and `vitest` as child processes on the **host** — the legacy in-process
path is still wired but the review slice goes through the sandbox today.

## 5. Deterministic fault injection only (no chaos)

Failure-injection tests (`FaultyDb` + the F1–F5 suite) throw a _queued_ error at
the head of the next matching query — deterministic, reproducible, no real network
failure or Postgres restart. Deliberately **no** chaos-monkey random faults:
reproducibility beats coverage when the point is to pin a single invariant.

## 6. Performance numbers are not SLAs

The load smoke reports p50/p95 durations and wall-clock, but these are **observations,
not guarantees**. Tuning against them before a real workload exists is how
projects die. A "performance baseline" item belongs on the Day-30 backlog — not a
tuning sprint now.
