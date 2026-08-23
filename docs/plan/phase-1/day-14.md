# Day 14 — Artifact Tracker Phase 1 & Week 2 Checkpoint

| | |
|---|---|
| **Week** | 2 — Execution Core (close-out) |
| **Spec refs** | Spec 5 — Artifact & Change Tracker (v0.1, updated) |
| **Estimated effort** | 6–7 h |
| **Prerequisites** | Day 13 (ArtifactCaptureSubscriber stub, `artifacts` row on `artifact.created`) |

---

## 1. Objectives

1. Turn the Day-13 capture stub into the real **Artifact Tracker**: full Artifact / Change / Snapshot lifecycle per updated Spec 5.
2. Implement **content-addressed storage** (SHA-256 dedup) and the rule that provenance metadata is never deleted.
3. Implement **event-driven Change.status** transitions: `PENDING → VERIFIED → REVIEWED`, and `any → ROLLED_BACK`.
4. Clarify in code + docs the Tracker/Git boundary: **Tracker = pre-commit source of truth; Git = post-merge** (commit SHA lives in Change metadata after Day-24 merge).
5. **Week 2 hard checkpoint**: integration smoke tests across Orchestrator + Runtime + Tracker; retro doc; stop-the-line rule if any criterion is red.

> **Why this matters:** the Tracker is the evidentiary backbone of the Harness. Verification evidence (Day 17), the review diff view (Day 23), and rollback all read from here. If capture or provenance is lossy, everything downstream is untrustworthy.

---

## 2. Design Decisions

### 2.1 Core domain model (recap from Spec 5)

Already defined in `@harness/domain` (Day 2); today we implement the persistence + service layer in `packages/artifact-tracker`.

- **Artifact** — a unit of produced work (file content, patch, command output). Status: `PENDING | VERIFIED | REVIEWED | MERGED | ROLLED_BACK` (`MERGED` added in the spec fix).
- **Change** — a logical grouping of artifacts belonging to one task attempt. Status: `PENDING → VERIFIED → REVIEWED`, `any → ROLLED_BACK` — **event-driven only**, never mutated directly by API handlers.
- **Snapshot** — immutable, content-addressed blob of an artifact's content at capture time.

### 2.2 Content-addressed snapshots (dedup)

```ts
// packages/artifact-tracker/src/snapshot-store.ts
import { createHash } from 'node:crypto';

export class SnapshotStore {
  constructor(private readonly db: Db) {}

  async save(content: string): Promise<{ snapshotId: string; deduped: boolean }> {
    const hash = createHash('sha256').update(content, 'utf8').digest('hex');
    // snapshots.id = sha256 hash → INSERT ... ON CONFLICT DO NOTHING = free dedup
    const res = await this.db
      .insertInto('snapshots')
      .values({ id: hash, content })
      .onConflictDoNothing()
      .returning('id')
      .executeTakeFirst();
    return { snapshotId: hash, deduped: res === undefined };
  }
}
```

**Rationale:** agents routinely rewrite identical content (no-op edits, formatter runs). Hash-keyed snapshots make dedup automatic and idempotent, and give us a tamper-evident content identity for free.

### 2.3 Tables (migration `0014_artifact_tracker.sql`)

```sql
CREATE TABLE snapshots (
  id          TEXT PRIMARY KEY,            -- sha256 of content
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE changes (
  id              TEXT PRIMARY KEY,        -- UUIDv7
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  attempt_number  INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','VERIFIED','REVIEWED','ROLLED_BACK')),
  metadata        JSONB NOT NULL DEFAULT '{}',  -- post-merge: { commit_sha, merged_at }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, attempt_number)
);

-- artifacts table already exists (Day 13 migration); add columns if missing:
ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS change_id TEXT REFERENCES changes(id),
  ADD COLUMN IF NOT EXISTS snapshot_id TEXT REFERENCES snapshots(id),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','VERIFIED','REVIEWED','MERGED','ROLLED_BACK'));
```

**Retention rule (from spec fix):** snapshot *content* may be pruned in a future retention job, but **provenance metadata — changes, artifacts rows, links, hashes — is never deleted.** No `DELETE` statements exist in this package; add a lint-level test asserting none appear in `packages/artifact-tracker/src`.

### 2.4 ArtifactTracker service

```ts
export class ArtifactTracker {
  constructor(
    private readonly db: Db,
    private readonly snapshots: SnapshotStore,
    private readonly bus: IEventBus,
  ) {}

  /** Called by ArtifactCaptureSubscriber (Day 13) — replaces its inline INSERT. */
  async capture(input: {
    taskId: string; attemptNumber: number; path: string; content: string;
    agentRunId: string;
  }): Promise<{ artifactId: string }> {
    return this.db.transaction(async (trx) => {
      const change = await getOrCreateChange(trx, input.taskId, input.attemptNumber);
      const { snapshotId } = await this.snapshots.save(input.content);
      const artifactId = uuidv7();
      await trx.insertInto('artifacts').values({
        id: artifactId, change_id: change.id, snapshot_id: snapshotId,
        task_id: input.taskId, path: input.path, status: 'PENDING',
        created_by: input.agentRunId,
      }).execute();
      return { artifactId };
    });
  }
}
```

### 2.5 Event-driven status transitions

A dedicated subscriber is the **only** writer of `changes.status` / escalated `artifacts.status`:

```ts
// packages/artifact-tracker/src/change-status-subscriber.ts
export function registerChangeStatusSubscriber(bus: IEventBus, db: Db): void {
  bus.subscribe('verification.completed', async (e) => {
    if (e.payload.result !== 'PASSED') return;
    await setChangeStatus(db, e.payload.changeId, 'VERIFIED', ['PENDING']);
    await db.updateTable('artifacts').set({ status: 'VERIFIED' })
      .where('change_id', '=', e.payload.changeId)
      .where('status', '=', 'PENDING').execute();
  });

  bus.subscribe('review.decision_submitted', async (e) => {
    await setChangeStatus(db, e.payload.changeId, 'REVIEWED', ['VERIFIED']);
    await db.updateTable('artifacts').set({ status: 'REVIEWED' })
      .where('change_id', '=', e.payload.changeId)
      .where('status', '=', 'VERIFIED').execute();
  });

  bus.subscribe('artifact.rollback_requested', async (e) => {
    await setChangeStatus(db, e.payload.changeId, 'ROLLED_BACK');  // from any state
  });
}

// guarded transition — 0 rows = no-op (idempotent re-delivery safe)
async function setChangeStatus(db: Db, id: string, next: string, from?: string[]) {
  let q = db.updateTable('changes').set({ status: next, updated_at: new Date() })
    .where('id', '=', id);
  if (from) q = q.where('status', 'in', from);
  await q.execute();
}
```

`MERGED` is set on Day 24 (merge-on-approve), which also writes `metadata.commit_sha`. Events consumed here are published on Days 15 (`verification.completed`) and 22 (`review.decision_submitted`); until then the subscriber is wired but idle — test it by publishing events directly on the bus.

### 2.6 Tracker vs Git boundary (docs)

Append to `docs/architecture/wiring-map.md` + a new short ADR `docs/architecture/artifact-tracker-vs-git.md`:

- **Tracker** owns everything *before* human approval → merge: content, diffs (Day 17), provenance, rollback record.
- **Git** owns everything *after* merge. The merge step (Day 24) writes the commit SHA back into `changes.metadata` — that is the single join point.
- Never shell out to git from `artifact-tracker` (boundary rule R4 + explicit package rule).

---

## 3. Tasks

- [ ] **3.1** Write migration `0014_artifact_tracker.sql` (snapshots, changes, artifacts ALTER). (45 min)
- [ ] **3.2** Implement `SnapshotStore` + dedup unit tests (same content twice → one row, `deduped: true`). (45 min)
- [ ] **3.3** Implement `ArtifactTracker.capture` (transactional get-or-create change + snapshot + artifact) and refactor `ArtifactCaptureSubscriber` to call it. (1 h)
- [ ] **3.4** Implement `ChangeStatusSubscriber` (3 handlers) + guarded `setChangeStatus`. (1 h)
- [ ] **3.5** Wire tracker + subscribers in `apps/api/src/bootstrap.ts`; update `docs/architecture/wiring-map.md`. (30 min)
- [ ] **3.6** Write ADR `docs/architecture/artifact-tracker-vs-git.md`. (30 min)
- [ ] **3.7** Tests: capture→PENDING; simulated verification.completed→VERIFIED; decision→REVIEWED; rollback from each state; guarded no-op on wrong source state; no-DELETE lint test. (1.5 h)
- [ ] **3.8** **Week 2 checkpoint** (see §5). (1 h)

---

## 4. Deliverables

| File | Description |
|---|---|
| `packages/artifact-tracker/migrations/0014_artifact_tracker.sql` | snapshots + changes tables, artifacts ALTER |
| `packages/artifact-tracker/src/snapshot-store.ts` | Content-addressed dedup store |
| `packages/artifact-tracker/src/artifact-tracker.ts` | Capture service (transactional) |
| `packages/artifact-tracker/src/change-status-subscriber.ts` | Sole writer of change/artifact status |
| `docs/architecture/artifact-tracker-vs-git.md` | ADR: pre-commit vs post-merge boundary |
| — (folded into `docs/retros/phase-1.md` §1 "schema drift") | Checkpoint results + retro |

---

## 5. Acceptance Criteria

**Artifact Tracker:**

- [ ] `write_file` tool call → `artifact.created` → artifacts row `PENDING` with snapshot + change linked (integration test).
- [ ] Identical content captured twice → exactly one `snapshots` row.
- [ ] Status transitions only via events; direct API mutation path does not exist.
- [ ] No `DELETE`/`TRUNCATE` anywhere in `packages/artifact-tracker/src` (lint test).
- [ ] `pnpm test`, `pnpm lint`, boundary tests all green.

**Week 2 hard checkpoint** (mirror Day-07 format — go/no-go table, recorded in `docs/retros/phase-1.md`):

- [ ] E2E smoke: create task → PENDING→QUEUED→EXECUTING→agent writes file→artifact captured PENDING (single script `scripts/week2-smoke.ts` against Docker Compose stack).
- [ ] State machine: all 22 transitions still enforced; attempt/idempotency invariants hold (`attempt_number`, `task_id:attempt_number` keys, max_attempts=3).
- [ ] Retry policy works: transient failure retries with jittered backoff; permanent failure → AWAITING_HUMAN_INTERVENTION; `retry_log` + `task_step_log` complete.
- [ ] MockLLM scripted run produces full `trajectory_steps` + `llm_call_log` with `request_hash` and token usage.
- [ ] Write 30-min retro: what slipped, what surprised, adjustments for Week 3 (trust pipeline).
- [ ] **If any criterion is red: stop.** Fix before starting Day 15 — do not carry a broken execution core into the trust pipeline.

---

## 6. Notes & Pitfalls

- **Idempotency of capture:** `artifact.created` may be re-delivered; `capture` must be safe to re-run — snapshot dedup helps, but also enforce a unique constraint on `(task_id, attempt_number, path, snapshot_id)` on `artifacts` if double-insert is observed in tests.
- **NaN-proof your transactions:** capture is 3 writes; keep them in one `db.transaction` so a crash never leaves an artifact without a snapshot or a change row.
- **Guarded status updates beat exceptions:** subscribers see at-least-once delivery; a 0-row guarded UPDATE is a correct no-op, not an error to log loudly.
- **The subscriber is idle until Days 15/22** — don't be tempted to set `VERIFIED` from anywhere else "temporarily"; test via direct bus publishes instead.
- **Checkpoint discipline:** the smoke script must run against the real Compose stack (postgres:16-alpine), not just in-process tests — Week 1's checkpoint caught wiring bugs only visible in the real topology.
- **Next:** [Day 15 — Verification Engine: Request Handler & Compile Check](day-15.md) starts the trust pipeline that flips these artifacts from PENDING to VERIFIED.

---

*Prev: [Day 13 — Tools & Trajectory Recorder](day-13.md) | Next: [Day 15 — Verification Engine: Request Handler & Compile Check](day-15.md)*
