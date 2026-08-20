# @harness/artifact-tracker — Artifact / Change Tracker

## Trạng thái hiện tại

Stubs: `src/index.ts` chỉ export string `'artifact-tracker'`. Chưa có implementation.

---

## Mục đích

Tracking mọi artifact generated bởi AI agent — maintained provenance, content-addressed snapshots, event-driven status transitions.

---

## Công việc cần làm

### Day 13 — Capture stub

```typescript
// src/artifact-capture-subscriber.ts
export class ArtifactCaptureSubscriber {
  constructor(private db: Db, private bus: IEventBus) {
    // Listen for tool calls that write files
    this.bus.subscribe('tool.write_file', async (event) => {
      const { taskId, agentRunId, filePath, content } = event.payload;
      await this.capture(taskId, agentRunId, filePath, content);
    });
  }

  async capture(taskId: TaskID, agentRunId: AgentRunID, filePath: string, content: string): Promise<void> {
    const artifactId = newArtifactID();
    const hash = sha256(content);
    await this.db.insert(artifacts).values({
      id: artifactId,
      task_id: taskId,
      agent_run_id: agentRunId,
      file_path: filePath,
      content_hash: hash,
      status: 'PENDING',
      created_at: new Date(),
    });
  }
}
```

### Day 14 — Full tracker + content-addressed snapshots

```typescript
// src/snapshot-store.ts
export class SnapshotStore {
  async save(content: string): Promise<{ snapshotId: string; deduped: boolean }> {
    const hash = sha256(content);
    // snapshots.id = sha256 hash → INSERT ... ON CONFLICT DO NOTHING = free dedup
    const res = await this.db.insert(snapshots)
      .values({ id: hash, content })
      .onConflictDoNothing()
      .returning('id');
    return { snapshotId: hash, deduped: res.length === 0 };
  }
}
```

### Day 14 — Diff engine

```typescript
// src/diff-engine.ts
import { structuredPatch } from 'diff'; // npm package

export class DiffEngine {
  async computeDiff(filePath: string, before: string, after: string): Promise<FileDiff> {
    const patch = structuredPatch(filePath, before ?? '', after, '', '', { context: 3 });
    return {
      path: filePath,
      diff: patchToString(patch),
      linesAdded: patch.hunks.reduce((sum, h) => sum + h.added, 0),
      linesRemoved: patch.hunks.reduce((sum, h) => sum + h.removed, 0),
    };
  }
}
```

### Day 14 — Event-driven Change.status

```typescript
// src/change-status-subscriber.ts
export class ChangeStatusSubscriber {
  constructor(private db: Db, private bus: IEventBus) {
    // verification.completed → PENDING → VERIFIED
    this.bus.subscribe('verification.completed', async (event) => {
      if (event.payload.result === 'PASSED') {
        await this.db.update(changes)
          .set({ status: 'VERIFIED', updated_at: new Date() })
          .where(eq(changes.id, event.payload.changeId));
      }
    });

    // review.decision_submitted → VERIFIED → REVIEWED
    this.bus.subscribe('review.decision_submitted', async (event) => {
      await this.db.update(changes)
        .set({ status: 'REVIEWED', updated_at: new Date() })
        .where(eq(changes.changeId, event.payload.changeId));
    });
  }
}
```

### Day 17 — Evidence linking

```typescript
// Link verification results to artifacts
// Table: evidence_links (evidence_id, artifact_id, change_id)
```

---

## Dependency rule

```
packages/artifact-tracker → import @harness/domain, @harness/event-bus, @harness/db
                          → KHÔNG import các engine packages khác
```

---

## Key design

- **Content-addressed dedup**: `snapshots.id = sha256(content)` — INSERT ... ON CONFLICT DO NOTHING
- **Provenance is never deleted**: metadata rows (changes, artifacts, links, hashes) là append-only
- **Event-driven status**: Change.status changes ONLY qua events, không qua direct API mutation
- **Tracker vs Git boundary**: Tracker = source of truth BEFORE commit; Git = source of truth AFTER merge

---

## Files cần tạo

```
src/
├── index.ts
├── artifact-tracker.ts         # Capture service (transactional)
├── snapshot-store.ts           # Content-addressed storage
├── diff-engine.ts              # Unified diff + line counts
├── provenance.ts               # ProvenanceChain assembly query
├── subscribers/
│   └── change-status-subscriber.ts
└── __tests__/
    ├── artifact-tracker.test.ts
    ├── snapshot-store.test.ts
    └── diff-engine.test.ts
```
