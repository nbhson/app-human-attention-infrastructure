# Day 17 — Evidence Storage, Provenance Linking & Diff Engine

| | |
|---|---|
| **Week** | 3 — Trust Pipeline |
| **Spec refs** | Spec 5 (provenance, updated); Spec 7 (evidence); Spec 1 §"Evidence before confidence" |
| **Estimated effort** | 6–7 h |
| **Prerequisites** | Day 14 (snapshots/changes), Day 15–16 (reports + check results), Day 02 (ProvenanceChain in domain) |

---

## 1. Objectives

1. Introduce the **Evidence** entity: durable, content-hashed records linking every claim (verification result, agent assertion) to its underlying proof (check output, test results, snapshot).
2. Backfill `evidence_id` on `verification_check_results` (field reserved on Day 15).
3. Implement the **Diff Engine**: unified diffs between the pre-task base snapshot and each artifact snapshot — the core input to the review UI (Day 23) and Attention complexity factor (Day 18).
4. Expose `ProvenanceChain` assembly: task → agent_run → llm_calls → trajectory_steps → artifacts → snapshots → verification reports → evidence. One query function, used by Day-26 provenance UI.
5. Guarantee: **every PASSED report has ≥1 evidence row** (DB-level-ish invariant enforced in code + test).

> **Why this matters:** this is the day "Claim ≠ Evidence" becomes a queryable fact rather than a slogan. Reviewers (Day 22–24) never see a bare "PASSED" — they see the PASSED *plus* the output that proves it.

---

## 2. Design Decisions

### 2.1 Evidence table (migration `0017_evidence.sql`)

```sql
CREATE TABLE evidence (
  id            TEXT PRIMARY KEY,          -- UUIDv7
  content_hash  TEXT NOT NULL,             -- sha256 of body (dedup, tamper-evidence)
  kind          TEXT NOT NULL CHECK (kind IN
    ('CHECK_OUTPUT','TEST_RESULTS','SNAPSHOT','LLM_TRANSCRIPT','DIFF','HUMAN_NOTE')),
  body          TEXT NOT NULL,             -- full, untruncated content
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evidence_links (              -- many-to-many, append-only
  id            TEXT PRIMARY KEY,
  evidence_id   TEXT NOT NULL REFERENCES evidence(id),
  subject_kind  TEXT NOT NULL,             -- 'check_result' | 'artifact' | 'report' | 'agent_run'
  subject_id    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (evidence_id, subject_kind, subject_id)
);

ALTER TABLE verification_check_results
  ADD COLUMN IF NOT EXISTS evidence_id TEXT REFERENCES evidence(id);
```

Same retention rule as snapshots (Day 14): evidence **never deleted**; no DELETE in code, lint test extended to `verification-engine` + new `evidence` module.

### 2.2 EvidenceStore

```ts
// packages/verification-engine/src/evidence-store.ts
export class EvidenceStore {
  async record(kind: EvidenceKind, body: string, links: EvidenceLink[]): Promise<string> {
    return this.db.transaction(async (trx) => {
      const id = uuidv7();
      await trx.insertInto('evidence')
        .values({ id, content_hash: sha256(body), kind, body }).execute();
      await trx.insertInto('evidence_links')
        .values(links.map(l => ({ id: uuidv7(), evidence_id: id, ...l }))).execute();
      return id;
    });
  }
}
```

**Integration point:** `VerificationEngine.persist` (Day 15) now stores full check output as evidence first (untruncated; the 64KB cap applies only to the inline `output` field), then sets `check_result.evidence_id`. TestCheck's per-test JSON also becomes one `TEST_RESULTS` evidence blob per run.

### 2.3 Diff Engine

```ts
// packages/artifact-tracker/src/diff-engine.ts
import { structuredPatch } from 'diff';    // 'diff' npm package — no git dependency (ADR Day 14)

export interface FileDiff {
  path: string;
  hunks: string;                           // unified diff text
  addedLines: number;
  removedLines: number;
  isNewFile: boolean;
}

export class DiffEngine {
  constructor(private readonly db: Db) {}

  /** Base = snapshot of the same path from the previous completed attempt,
   *  or empty (isNewFile) if the path has no prior snapshot. */
  async diffChange(changeId: string): Promise<FileDiff[]> {
    const artifacts = await this.db.selectFrom('artifacts')
      .innerJoin('snapshots', 'snapshots.id', 'artifacts.snapshot_id')
      .where('change_id', '=', changeId).selectAll().execute();
    return artifacts.map(a => {
      const base = this.findBaseSnapshot(a.task_id, a.path, a.attempt_number);
      const patch = structuredPatch(a.path, base?.content ?? '', a.content, '', '', { context: 3 });
      return { path: a.path, hunks: patch, ...countLines(patch), isNewFile: !base };
    });
  }
}
```

Diffs are computed **on demand** and cached as one `DIFF` evidence row per change (keyed via evidence_links) — recompute skipped if content hashes unchanged. Line counts feed Attention `complexity` (Day 18).

### 2.4 ProvenanceChain assembly

```ts
// packages/artifact-tracker/src/provenance.ts  (read-only query module)
export async function buildProvenanceChain(db: Db, taskId: string): Promise<ProvenanceChain> {
  // single function, 7 queries, assembled in memory — matches domain type from Day 02:
  return {
    task,                          // tasks row
    agentRun,                      // agent_runs row for current attempt
    llmCalls,                      // llm_call_log where agent_run_id
    trajectory,                    // trajectory_steps ordered
    artifacts,                     // + snapshots (content_hash)
    verification: { report, checkResults, evidenceIds },
    events,                        // event_log where correlation_id = taskId
  };
}
```

Used by: Day-23 review UI (diff + evidence), Day-26 provenance UI, Day-27 audit queries. Kept in `artifact-tracker` because it primarily reads tracker tables (R4 allows it to read others' tables via db — boundary rules govern **code imports**, and provenance is tracker-owned conceptually).

---

## 3. Tasks

- [ ] **3.1** Migration `0017_evidence.sql` + Drizzle schema. (45 min)
- [ ] **3.2** `EvidenceStore.record` + transaction + dedup test. (45 min)
- [ ] **3.3** Wire into `VerificationEngine.persist` + TestCheck (full output as evidence; set `evidence_id`). (1 h)
- [ ] **3.4** `DiffEngine` with `diff` package, base-snapshot resolution, line counting, evidence caching. (1.5 h)
- [ ] **3.5** `buildProvenanceChain` query function. (1 h)
- [ ] **3.6** Tests: invariant "PASSED report ⇒ ≥1 evidence row"; diff of modified file shows hunks; new file diff has `isNewFile`; provenance chain contains all 7 sections for a seeded task; no-DELETE lint extended. (1.5 h)

---

## 4. Deliverables

| File | Description |
|---|---|
| `packages/verification-engine/migrations/0017_evidence.sql` | evidence + evidence_links + evidence_id column |
| `packages/verification-engine/src/evidence-store.ts` | Transactional evidence writer |
| `packages/artifact-tracker/src/diff-engine.ts` | On-demand unified diffs + counts |
| `packages/artifact-tracker/src/provenance.ts` | ProvenanceChain assembly query |

---

## 5. Acceptance Criteria

- [ ] Every PASSED/FAILED/FLAKY report has evidence rows linked to each check result (invariant test).
- [ ] `diffChange` returns correct unified diff for a modified file and `isNewFile: true` for a created file; line counts accurate.
- [ ] `buildProvenanceChain(taskId)` returns all 7 sections populated for an end-to-end seeded task.
- [ ] Evidence content is untruncated even when inline `output` was capped.
- [ ] No DELETE in verification-engine/artifact-tracker source (lint test).
- [ ] `pnpm test && pnpm lint` green.

---

## 6. Notes & Pitfalls

- **Base snapshot ambiguity:** if a path was written by attempt 1 and attempt 2, base for attempt 2's diff = attempt 1's snapshot *of the same path*. If the agent rewrote an existing repo file on attempt 1, base = the file's content at worktree creation (captured as a snapshot by the runtime — verify Day-12 capture hook does this; if not, add it today and note it).
- **Don't diff binaries/large files** in Phase 1: cap diffable size (e.g., 1MB); larger → store `DIFF_SKIPPED` metadata instead.
- **Evidence dedup:** identical check output across retries hashes identically — that's fine; `evidence_links` UNIQUE constraint makes re-links idempotent.
- **ProvenanceChain is read-heavy:** 7 sequential queries are fine at Phase-1 scale; resist adding a cache until Day-27 observability shows a need.
- **Next:** [Day 18 — Attention Engine Scoring](day-18.md) starts consuming `flaky`, diff line counts, and verification results as scoring factors.

---

*Prev: [Day 16 — Test Executor, Timeouts & Flaky Handling](day-16.md) | Next: [Day 18 — Attention Engine Scoring](day-18.md)*
