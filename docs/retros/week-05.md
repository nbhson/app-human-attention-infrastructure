# Phase 2 · Week 5 Retro — New address spaces, integrated but not yet trusted

*Day-25 checkpoint (Phase 2). Fifth pass, over the object store, the two
sandboxes, Spec 8's human-review surface, and the report that finally reads them
together. Same rule as every prior retro: honest by design, numbers-first,
blameless — and green before committed. This week's verdict is about **trust**:
the subsystems now integrate, but "integrated" is not "survives failure", and the
fallback path — not the happy path — is what earns the cut-over.*

## What shipped this week

- **Day 21 — object store.** A content-addressed `ContentStore` (S3/MinIO, with
  an in-memory dev fallback) offloads large `changes.content` blobs; `SnapshotStore`
  keeps small content inline and offloads above a threshold (`content_backend`
  `'db'` / `'object'`). Read-back is hash-verified and throws
  `ContentIntegrityError` on digest drift.
- **Day 22 — sandboxed verification.** `SandboxedCheck` runs Verify checks in a
  container with `--network none`, mapping exit code/timeout to PASSED/FAILED/
  TIMED_OUT, and degrades to the **in-process parity path** on `SandboxInfraError`
  rather than recording a false FAILED.
- **Day 23 — sandboxed code mode.** Tier-2 tool calls run isolated with
  approval gating, recorded in `code_mode_sessions` with `tool_calls`.
- **Day 24 — Spec 8.** The human-review interface's finite state machine
  (`claim`/`decide`/`release`/`escalate`/`drop`) and closed `verdict` enum are a
  versioned contract and a tested surface.
- **Day 25 — the checkpoint itself.** The continuous Week-5 signals
  (`harness_sandbox_{run,fallback}_total`, `harness_sandbox_duration_seconds`,
  `harness_object_store_integrity_error_total`) plus the cache hit/miss pair are
  surfaced in the report as an `infra` section derived from a counter snapshot, a
  `shadow` section read from `shadow_rank_comparisons`, and a visible
  `rankMethod = 'keyword'` invariant.

## What the numbers say — and what they don't say yet

The honest read of Week 5 is that **the alert surface is built but unloaded**. On
a freshly seeded dev DB every new counter sits at zero until traffic exercises it:
the fallback rate's information arrives only when the sandbox *fails*, the
integrity counter only when a blob *drifts*, and the cache ratio only after a
*second* run. That is the correct posture for a checkpoint — a liveness signal
must read `0` before load rather than be absent until it is needed — but it means
the week's real proof is the mechanism and its tests, not a headline number.

The three numbers that will matter first, in order of confidence:

1. **`sandboxFallbackRate`** (`fallbacks / (runs + fallbacks)`) — the single best
   liveness signal for the whole week. A non-zero rate means the isolation is not
   actually being used. It is computed, recorded, and rendered; it is *not* yet
   meaningfully non-zero anywhere, because Day 27 is the first honest end-to-end
   run.
2. **`sandboxAvgDurationMs`** — the first place regression hides. Container
   startup cost quietly inflates dwell and task latency; it is now measured per
   run into a histogram, so Day 26 has a baseline to detect drift against.
3. **`objectIntegrityErrors`** — a drift counter that should stay at zero forever.
   Its presence in the report is binary (absent = no drift); a non-zero read is a
   data-integrity event, not a tuning knob.

## The invariants, and what holds them

- **The served ranking is still keyword.** The report now renders
  `rankMethod = 'keyword'` (the reduced keyword-vs-semantic distinction of the
  persisted `phase1-keyword-dependency`), so a shadow leak is visible rather than
  merely absent. Held by `semantic-shadow.test.ts` (week 4) and the report's
  always-present `rankMethod` field (day 25).
- **No engine reached for another engine.** `artifact-tracker` gained a dependency
  on `@harness/observability` this week to instrument object-integrity — shared
  infra, permitted by the boundary matrix (`engine → […, 'observability', …]`,
  R8). `object-store` (R11) and `sandbox` (R12) remain leaves with no
  `@harness/*` import. The architecture test is green.
- **Fallback is loud, not silent.** Every `SandboxInfraError` counts a fallback
  and logs a structured warning before degrading. The parity test proves the
  fallback verdict agrees with the container verdict on the same fixtures.

## What is still missing (Week 5 must not paper over it)

- **A live end-to-end run that loads the alert surface.** The `--once` report CLI
  is a fresh process, so its `infra` snapshot reads this process's lifetime
  counters — zero. The report *renders* `infra` with honest holes, but the holes
  only fill once a long-lived process (Day 27) has both traffic and the report
  generator in the same address space.
- **No TTL sweep on the cache** (carried from Week 4) and **no failure injection**
  (the explicit Day 26 deliverable). The object store, the sandbox, and the
  pgvector index can all fail in ways the happy-path demo does not exercise.

## What is fragile — and the single surface Day 26 must hit first

**The object-store read-back is the likeliest first failure.** Three things
converge there: it is the *only* path that can silently poison a diff if its
integrity check is ever bypassed (`ContentIntegrityError` is the backstop); it is
the newest in the write→read round-trip (the `content_hash` is written by
`SnapshotStore` and re-read by `DiffEngine.contentFor` / `MergeService`); and its
failure modes are the least rehearsed — a missing object, a digest drift, a store
that hangs. The sandbox, by contrast, already has the in-process parity path
armed, so its worst case is a loud fallback rather than a wrong answer. The vector
index is behind an opt-in shadow flag, so it cannot corrupt the served path.

**So: Day 26's failure-injection effort should hit the object store hardest** —
missing blob, corrupt blob (forced digest drift), and a slow/hung store — *then*
the sandbox (daemon down, image missing, timeout), *then* the index. The goal is
not "the store never fails"; it is "a store failure degrades to a loud, counted,
correct answer rather than a silently-wrong diff or a hung run".

## Decisions / debts carried into Week 6

- **Do not cut over to sandbox-only verification on demo success.** Week 5 proves
  the subsystems *work together*; Day 26 proves they *survive failure*. The
  in-process parity path stays the armed default until failure injection passes.
- **The semantic switch stays parked.** Nothing in Week 5 changes the Day 29 A/B
  read; `shadow_rank_comparisons` now *is* consumed by the report (mean Kendall
  tau), which is the first honest consumption of the week-4 shadow signal, but it
  is a *description*, not a *decision*.

---

*Checkpoint rule applied: `pnpm lint`, `pnpm -r typecheck`, and `pnpm -r test`
are green; `pnpm e2e` (migrate through 0030 + happy path + 8 failure scenarios)
is green. The report renders `shadow` / `infra` / `rankMethod`; the served
`rank_method` is `phase1-keyword-dependency` (report `rankMethod = 'keyword'`);
`sandbox` (R12) and `object-store` (R11) remain leaves; R4/R8 are asserted by
`packages/di/src/__tests__/architecture.test.ts`.*