# Day 2 — `packages/domain`: Core Types & Branded IDs

**Week:** 1 — Foundation
**Spec refs:** Orchestrator §2 (Task), Agent Runtime §2 (AgentRun), Artifact Tracker §2 (Artifact/Change), Context Engine §2 (ContextSnapshot), Attention §2 (Assessment), Verification §2 (Request/Result)
**Estimated effort:** 6–8h

---

## 1. Objectives

Create the single source of truth for all shared domain types. Every other package depends on `@harness/domain`; if two packages need the same concept, it lives here. Getting IDs and status enums right today prevents cross-package drift later.

## 2. Design Decisions (locked)

- **Branded string IDs** via a `brand` helper: `type TaskID = string & { __brand: 'TaskID' }`. Prevents passing an `ArtifactID` where a `TaskID` is expected — the #1 cross-module bug class.
- **Status enums as const objects + union types** (not TS `enum`): `export const TaskStatus = { Pending: 'PENDING', ... } as const; export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];`
- **Entities are plain interfaces + factory functions** (`createTask(input): Task`). No classes with behavior in domain — behavior lives in packages.
- **Timestamps are `Date` in TS**, stored as `timestamptz` in Postgres (Day 4).
- IDs for: TaskID, AgentRunID, ArtifactID, ChangeID, SnapshotID (artifact), ContextID (context snapshot), AssessmentID, VerificationRequestID, VerificationResultID, EvidenceID, ProjectID, DecisionID, EventID.

## 3. Tasks

### 3.1 ID & primitive module (90 min)
- [x] `src/ids.ts`: brand helper + all 13 branded ID types + `newTaskID()` etc. (UUIDv7 via `uuid` — time-sortable, helps Postgres indexing).
- [x] `src/result.ts`: `Result<T, E>` type (`{ ok: true, value } | { ok: false, error }`) for explicit error handling in pure logic.
- [x] Tests: ID factories produce unique, branded, parseable values.

### 3.2 Task types (60 min)
- [x] `src/task.ts`: `Task` interface per spec 2 §2 (id, title, requirements, state, priority, attemptNumber, projectId, createdAt/updatedAt, metadata).
- [x] `TaskState` const-union with **all** canonical states from spec 2 §3: `PENDING, QUEUED, EXECUTING, VERIFYING, AWAITING_REVIEW, APPROVED, REJECTED, REWORK, COMPLETED, FAILED, AWAITING_HUMAN_INTERVENTION, CANCELLED`.

### 3.3 Execution & artifact types (90 min)
- [x] `src/agent-run.ts`: `AgentRun`, `AgentRunStatus`, `TrajectoryStep` (thought, toolCall, observation per spec 3 §2/§5), `AgentExecutionRequest` (incl. `maxSteps`, default 10).
- [x] `src/artifact.ts`: `Artifact`, `ArtifactStatus` (incl. `MERGED`), `Change`, `ChangeStatus`, `FileChange` per spec 5 §2.
- [x] `src/context.ts`: `ContextSnapshot`, `ContextItem` with `contentHash`, token counts per spec 4 §2.

### 3.4 Trust-pipeline types (90 min)
- [x] `src/verification.ts`: `VerificationRequest`, `VerificationResult`, `VerificationCheckResult` (status incl. `FLAKY` handling flag in metrics), `VerificationError` per spec 7 §2.
- [x] `src/attention.ts`: `AttentionAssessment`, `AttentionScores`, `AttentionFactor`, `AttentionPolicy`, `PriorityLabel` per spec 6 §2.
- [x] `src/review.ts`: `HumanDecision` (APPROVE/REJECT/REQUEST_CHANGES), `ReviewQueueItem`.

### 3.5 Provenance (45 min)
- [x] `src/provenance.ts`: `ProvenanceChain` per spec 5 §8 — the composited read-model the UI will render on Day 26.

### 3.6 Barrel export + docs (30 min)
- [x] `src/index.ts` re-exports everything, grouped by submodule.
- [x] `packages/domain/README.md`: one paragraph per module, and the rule "no imports from other `@harness/*` packages, ever".

## 4. Deliverables

- `@harness/domain` compiling, fully typed, unit-tested, zero dependencies on other workspace packages.

## 5. Acceptance Criteria

- [x] All status unions match specs exactly (grep-check each enum against its spec doc).
- [x] Branded ID misuse is a compile error (write a `@ts-expect-error` test proving it).
- [x] ≥ 90% of exported symbols have TSDoc comments.
- [x] `pnpm -F @harness/domain test` green; package builds standalone.

## 6. Notes & Pitfalls

- Resist adding "nice to have" fields. Only spec'd fields + `metadata` maps. New fields require a spec change first.
- UUIDv7 choice matters: UUIDv4 breaks index locality; ULID is fine too — pick one and document it.

## 7. Status vs Plan (scanned 2026-08-20)

All 14 task checkboxes and 4 acceptance criteria are done. `@harness/domain` builds standalone, typechecks, lints clean (eslint + prettier), and its 20 tests are green (31 repo-wide).

Divergences from the plan's line items:

- **17 ID types, not 13** (§2, §3.1): added `WorkflowID`, `PolicyID`, `ClaimID`, `ReviewerID`. No `CorrelationID` type was added.
- **UUIDv7 hand-rolled** (§3.1): implemented in `src/ids.ts` via `node:crypto` `randomBytes` (RFC 9562), not the `uuid` npm package — keeps `@harness/domain` dependency-free.
- **`TaskStatus`, not `TaskState`** (§3.2): the const-union is named `TaskStatus` and has **13** states — the spec's 12 canonical states plus `RETRYING`. `Task` fields use `name`/`status`/`retryCount`/`maxRetries` (not `title`/`state`/`attemptNumber`), and include `workflowId`, `owner`, `agents`, `timeoutSeconds` rather than `projectId`.
- **`ContextSource`, not `ContextItem`** (§3.3): context items are modeled as `ContextSource` with a `contentHash`; `ContextSnapshot` carries token totals and a ranking method.
- **`HumanDecisionType` has 6 states** (§3.4): `APPROVED`, `REJECTED`, `REQUEST_CHANGES`, `OVERRIDDEN`, `DEFERRED`, `ESCALATED`.
- **`VerificationCheckResult.flaky?`** (§3.4): the FLAKY metric is carried as an optional boolean flag.
- **No per-package `test` script**: tests run from the workspace root via `pnpm test` (`vitest run` with the root `vitest.config.ts` include `packages/*/src/**/*.test.ts`). `pnpm -F @harness/domain test` has no matching script; running vitest from the package cwd (`packages/domain`) resolves no test files.

Tests added: `ids.test.ts` (uuidv7 format / time-sortability / uniqueness / out-of-range rejection + factory uniqueness), `branding.test.ts` (the `@ts-expect-error` compile-time proof that a plain string and a foreign branded ID are rejected), `factories.test.ts` (factory defaults across entities), `index.test.ts` (barrel smoke).
