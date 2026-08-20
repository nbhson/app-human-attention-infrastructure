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
- [ ] `src/ids.ts`: brand helper + all 13 branded ID types + `newTaskID()` etc. (UUIDv7 via `uuid` — time-sortable, helps Postgres indexing).
- [ ] `src/result.ts`: `Result<T, E>` type (`{ ok: true, value } | { ok: false, error }`) for explicit error handling in pure logic.
- [ ] Tests: ID factories produce unique, branded, parseable values.

### 3.2 Task types (60 min)
- [ ] `src/task.ts`: `Task` interface per spec 2 §2 (id, title, requirements, state, priority, attemptNumber, projectId, createdAt/updatedAt, metadata).
- [ ] `TaskState` const-union with **all** canonical states from spec 2 §3: `PENDING, QUEUED, EXECUTING, VERIFYING, AWAITING_REVIEW, APPROVED, REJECTED, REWORK, COMPLETED, FAILED, AWAITING_HUMAN_INTERVENTION, CANCELLED`.

### 3.3 Execution & artifact types (90 min)
- [ ] `src/agent-run.ts`: `AgentRun`, `AgentRunStatus`, `TrajectoryStep` (thought, toolCall, observation per spec 3 §2/§5), `AgentExecutionRequest` (incl. `maxSteps`, default 10).
- [ ] `src/artifact.ts`: `Artifact`, `ArtifactStatus` (incl. `MERGED`), `Change`, `ChangeStatus`, `FileChange` per spec 5 §2.
- [ ] `src/context.ts`: `ContextSnapshot`, `ContextItem` with `contentHash`, token counts per spec 4 §2.

### 3.4 Trust-pipeline types (90 min)
- [ ] `src/verification.ts`: `VerificationRequest`, `VerificationResult`, `VerificationCheckResult` (status incl. `FLAKY` handling flag in metrics), `VerificationError` per spec 7 §2.
- [ ] `src/attention.ts`: `AttentionAssessment`, `AttentionScores`, `AttentionFactor`, `AttentionPolicy`, `PriorityLabel` per spec 6 §2.
- [ ] `src/review.ts`: `HumanDecision` (APPROVE/REJECT/REQUEST_CHANGES), `ReviewQueueItem`.

### 3.5 Provenance (45 min)
- [ ] `src/provenance.ts`: `ProvenanceChain` per spec 5 §8 — the composited read-model the UI will render on Day 26.

### 3.6 Barrel export + docs (30 min)
- [ ] `src/index.ts` re-exports everything, grouped by submodule.
- [ ] `packages/domain/README.md`: one paragraph per module, and the rule "no imports from other `@harness/*` packages, ever".

## 4. Deliverables

- `@harness/domain` compiling, fully typed, unit-tested, zero dependencies on other workspace packages.

## 5. Acceptance Criteria

- [ ] All status unions match specs exactly (grep-check each enum against its spec doc).
- [ ] Branded ID misuse is a compile error (write a `@ts-expect-error` test proving it).
- [ ] ≥ 90% of exported symbols have TSDoc comments.
- [ ] `pnpm -F @harness/domain test` green; package builds standalone.

## 6. Notes & Pitfalls

- Resist adding "nice to have" fields. Only spec'd fields + `metadata` maps. New fields require a spec change first.
- UUIDv7 choice matters: UUIDv4 breaks index locality; ULID is fine too — pick one and document it.
