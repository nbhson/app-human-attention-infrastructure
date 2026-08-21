# Week 2 Checkpoint — Execution Core

**Date:** 2026-08-21
**Weeks covered:** Day 08 → Day 14
**Status:** GO (see table below)

---

## 1. What shipped this week

| Day | Deliverable | Status |
|---|---|---|
| 08 | Pull-based Dispatch core (`Dispatcher`, `DispatchLoop`, `dispatch_log` idempotency) | ✅ |
| 09 | Linear workflow runner (`StepKind`, `LINEAR_WORKFLOW_V1`) | ✅ |
| 10 | Retry policy + failure classification (`retry_log`, jittered backoff) | ✅ |
| 11 | LLM provider abstraction (`LoggingLLMProvider`, Anthropic + Mock adapters) | ✅ |
| 12 | `AgentRunner` + `ReActLoop` + runtime poll loop | ✅ |
| 13 | Sandbox tools (`read_file`/`write_file`/`list_directory`), `TrajectoryRecorder` | ✅ |
| 14 | **Artifact Tracker Phase 1** (below) | ✅ |

### Day 14 — Artifact Tracker Phase 1

- **`SnapshotStore`** — content-addressed snapshots, SHA-256 dedup (identical
  content → one row).
- **`ArtifactTracker.capture`** — one transaction: get-or-create `artifacts` row
  → append `changes` (PENDING) → content-address into `snapshots` → repoint
  `artifacts.current_change_id`.
- **`ArtifactCaptureSubscriber`** — refactored from the Day-13 inline insert to
  forward `artifact.created` into `ArtifactTracker.capture`.
- **`ChangeStatusSubscriber`** — the *only* writer of `changes.status`:
  `PENDING → VERIFIED → REVIEWED`, `any → ROLLED_BACK`, all event-driven and
  guarded (`0 rows` = silent no-op).
- **ADR** `artifact-tracker-vs-git.md` — Tracker = pre-commit truth, Git =
  post-merge (single join point: `changes.commit_sha`, Day 24).
- **No-delete** lint test — provenance metadata is append-only.

---

## 2. Schema reconciliation (deviation from the plan)

The Day-14 plan's §2.3 migration sketch predates the Day-04 schema. The
`snapshots`, `changes`, and `artifacts` tables **already exist** (Day 04, updated
Spec 5), so **no migration was written**. Key adaptations:

- `changes` is **per-file** (`artifact_id` FK + `agent_run_id` FK), not the
  plan's per-`(task_id, attempt_number)` grouping.
- `artifacts` has no `PENDING` status — it uses the Day-02 `ArtifactStatus`
  lifecycle (`DRAFT → … → MERGED`). A freshly captured artifact starts `DRAFT`;
  the **change** is `PENDING`. The plan's "artifact PENDING" criterion maps to
  "change PENDING + artifact DRAFT".
- `Snapshot` dedup keys on the existing `content_hash` column (the `id` is
  UUIDv7, not the hash), via a check-then-insert inside the capture transaction.
- `changes.diff_summary` is a minimal human label today; the real diff engine is
  out of scope for Day 14 (deferred with verification evidence, Day 17).
- Event payloads were **enriched**: `artifact.created` += `content`;
  `verification.completed` += `change_id`; new `artifact.rollback_requested`
  event added — so the tracker can build the full chain without reading the
  sandbox or shipping a new change model.

---

## 3. Day 14 acceptance criteria

| Criterion | Verdict |
|---|---|
| `write_file` → `artifact.created` → artifact + `PENDING` change + snapshot linked | ✅ `week2-smoke.test.ts` |
| Identical content captured twice → exactly one `snapshots` row | ✅ `snapshot-store.test.ts` |
| Status transitions only via events; no direct mutation path | ✅ `ChangeStatusSubscriber` is the sole `changes.status` writer |
| No `DELETE`/`TRUNCATE` in `packages/artifact-tracker/src` | ✅ `no-delete.test.ts` |
| `pnpm test`, `pnpm lint`, boundary tests green | ✅ (recorded below) |

---

## 4. Week 2 hard checkpoint — go/no-go

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | E2E smoke: create → PENDING→QUEUED→EXECUTING → write file → artifact captured | ✅ | `apps/api/src/__tests__/week2-smoke.test.ts` (in-process, isolated schema) |
| 2 | State machine: all transitions enforced; `attempt_number` / idempotency invariants hold | ✅ | `week1-smoke.test.ts` + orchestrator/states machine tests (unchanged this week) |
| 3 | Retry policy: transient retry with jitter; permanent → `AWAITING_HUMAN_INTERVENTION`; logs complete | ✅ | Day-10 retry-policy + classifier tests (unchanged this week) |
| 4 | `MockLLM` scripted run produces full `trajectory_steps` + `llm_call_log` with `request_hash`/tokens | ✅ | Day-11/12/13 agent-runtime tests (unchanged this week) |
| 5 | 30-min retro (below) | ✅ | §5 |

> **Compose-stack smoke (deferred, not blocking):** the plan asks for a
> `scripts/week2-smoke.ts` against `postgres:16-alpine`. The in-process smoke
> above exercises the *same* graph against a real Postgres schema; a container
> run is a manual follow-up and was not automated in this pass.

**Result: GO** — the execution core (Orchestrator + Runtime + Tracker) is green
and safe to build the Week-3 trust pipeline on.

---

## 5. Retro (what slipped, what surprised, adjustments for Week 3)

**Slipped**
1. **Plan drift vs. committed schema.** Day-14's migration and `capture`
   sketches assumed a `PENDING`-status `artifacts` row and a
   per-`(task_id, attempt_number)` `changes` table; Day-04 had already built a
   per-file, content-addressed model. Resolution was correct but consumed a
   chunk of the day.
2. **Diff engine descoped.** The README lists `diff-engine.ts` but Day-14's task
   list does not; I left it for Day 17 (verification evidence) rather than build
   a half-trustworthy diff now.

**Surprised**
1. **Event payload was the real constraint.** The tracker cannot capture without
   `content`, and the Day-13 `artifact.created` did not carry it. Enriching the
   payload (not the tool context) was the smallest correct change, and it kept
   `artifact-tracker` free of filesystem coupling.
2. **Drizzle transaction typing.** Passing the transaction into `SnapshotStore`
   needed a structural `Pick<DrizzleDB, 'select' | 'insert'>` executor type —
   worth a shared util once a second package needs it.

**Adjustments for Week 3 (trust pipeline)**
1. **Verify event contracts before building consumers.** `verification.completed`
   needed a `change_id` field that didn't exist yet; Day 15 must publish the
   payload the tracker already expects, not a stale sketch.
2. **Write the schema reconciliation into the day plan** as soon as it's found,
   so the checkpoint doc records *why*, not just *what*.
3. **Automate the Compose smoke** early in Week 3 — the in-process substitute
   is sound but the plan wants a real-topology run at least once before trust.