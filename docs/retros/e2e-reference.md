# Phase 2 · Day 27 — End-to-End Reference Run

*The reference run for the Week-6 E2E. A benchmark, not a snapshot of perfection:
Phase 3 compares future canary outputs against these numbers. Recorded from a
clean-but-ordinary dev run on a local Docker Postgres; trace ids are per-run (a
fresh root span each time) and are recorded here for provenance, not as a stable
value to diff against.*

## What this run proves

One canonical task (`fixtures/e2e/happy-path` — the greeting bug) was driven
through the whole Phase-2 pipeline and then **reconstructed from append-only
telemetry**. Functional completion alone is not the pass; the run is green only
because it is also *observable*: the trace maps back to the task, the decision is
attributed to a live actor, the verification is attributable to exact bytes, and
the served context stayed on the keyword path with the semantic shadow recorded
alongside it.

## The functional chain (what completed)

| Stage | Evidence asserted |
|-------|-------------------|
| Auth | mock OIDC login → `sid` cookie; fixed `e2e-reviewer` principal (`OPERATOR` + `REVIEWER`) |
| Context | `contexts` snapshot captured; `rank_method = phase1-keyword-dependency`; `shadow_rank_comparisons` row written |
| Agent | scripted MockLLM drives a `write_file` fix; no real key, no network |
| Artifact | `changes` row → `commit_sha` set on merge; artifact reaches `MERGED` |
| Verification | `verification_reports.overall = PASSED`; `content_hash` non-null |
| Review | queue item routed (`rule_id` set), claimed, `APPROVE` with `actor_id` + rationale |
| Outcome | `tasks.state = COMPLETED` |

## The event log, replayed in causal order

```text
task.state_changed → task.state_changed → artifact.created →
task.execution_finished → task.state_changed → verification.completed →
task.state_changed → attention.assessment_created → attention.item_routed →
review.item_claimed → task.state_changed → review.decision_submitted →
artifact.merged → task.state_changed
```

14 events. Every milestone is present and in order: `artifact.created`,
`task.execution_finished`, `verification.completed`,
`attention.assessment_created`, `attention.item_routed`,
`review.decision_submitted`, `artifact.merged` (the Day-25 milestone list).

## Reconstructed telemetry

| Field | Value (sample run) |
|-------|--------------------|
| `trace_id` | `1c75713d1fcfecd0f3d3ada0bb3c6fee` (per-run) |
| `events` replayed | 14 |
| `decisions` | 1 |
| `verifications` | 1 |

`reconstruct(correlation_id)` asserted, not just read:

- every `review.decision_submitted` has non-null `actor_id` → **passed**;
- every `verification_reports` has non-null `content_hash` → **passed**.

## Infra counters observed (sample run)

| Counter | Value | Tenant |
|---------|-------|--------|
| `cacheHit` / `cacheMiss` | 0 / 3 | context sources read from disk on first collect (no second run to hit) |
| `sandboxRun` / `sandboxFallback` | 0 / 0 | driver runs the in-process COMPILE parity path (no `docker build` in the hot path, day-27 §6); the container path is proven by `sandboxed-check.test.ts` + `image.test.ts` |
| `objectIntegrityError` | 0 | no SHA-256 drift on any object-store read-back |

The counter assertion the driver enforces is `cacheHit + cacheMiss >= 1` — the
context cache *moved*. `sandboxRun = 0` is expected here and documented, not a
deficit: sandboxed verification is opt-in via `VERIFY_SANDBOX_ENABLED=1` and is
covered by the unit parity tests rather than the deterministic driver.

## Seam guard

`packages/di/src/__tests__/architecture.test.ts` — the `seam guards (day-27 §2.4 /
§3.4)` block (12 concrete classes across 6 seams) asserts **no engine package
instantiates a seam concrete** (`new ObjectStoreContentStore`, `new DockerSandbox`,
`new InProcessEventBus`, …). Green. R1–R12 dependency rules also green.

## Failure paths (the other half of the E2E)

`pnpm e2e` also runs `e2e-failure-paths.ts`: all 8 scenarios passed (orphaned
`EXECUTING` drain, idempotent event writes, and the Day-26 injection matrix).

## Honest limits

- **Nothing is optimized yet.** These are first-run numbers; Phase 3's job is to
  keep them from drifting (especially `sandboxRun`/`sandboxFallback` once a canary
  runs with the image pre-built and `VERIFY_SANDBOX_ENABLED=1`).
- **`cacheHit = 0` is real**: a single collect reads from disk. The hit path is
  proven by `context-cache.test.ts` (zero-read `chmod 000` test), not by this run's
  single-shot fixture.
- **Trace ids are not stable values.** They change every run; what must stay stable
  is the *existence* of the `trace_correlation` mapping, which the reconstruct
  assertion enforces.

---

*Green gate: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` (673 tests, 129
files), and `pnpm e2e` (happy path + 8 failure scenarios) all passed before this
was committed.*