# @harness/artifact-tracker — Artifact Capture, Diff & Provenance

Tracks what the agent changed: snapshots on seen artifacts, diffs between
versions, and the provenance chain that proves which task produced which change.

**Status:** complete (as-built) ·
**Boundary rule:** engine — imports only shared packages; **sole writer** of `changes.status`.

---

## Purpose

1. **Capture** a snapshot whenever an artifact is created or changed.
2. **Diff** the new version against the previous one.
3. **Record provenance** — which task, agent run, and model produced the change.
4. **Own `changes.status`** — the single writer, so readers see a consistent transition.

---

## Flow

```text
        artifact.created / artifact.changed  (from agent-runtime)
                            │
                            ▼
        ┌─────────────────────────────────────────┐
        │   artifact-capture-subscriber            │
        │   (listens, then captures)               │
        └──────────────────┬──────────────────────┘
                           ▼
        ┌─────────────────────────────────────────┐
        │   artifact-tracker.capture()             │
        │   1. snapshot-store: store snapshot      │
        │   2. diff-engine: diff vs previous        │
        │   3. provenance: task → run → change      │
        └──────────────────┬──────────────────────┘
                           ▼
        ┌─────────────────────────────────────────┐
        │   change-status-subscriber               │
        │   (sole writer of changes.status)        │
        └─────────────────────────────────────────┘
```

---

## Provenance

Every diff carries its provenance, closing the loop from "what changed" to
"who/why":

```text
Change
├── Task        (which task)
├── Agent run   (which execution)
├── Model       (which model)
├── Files       (which paths)
├── Diff        (what changed)
└── Snapshot    (content-addressed before/after)
```

---

## Modules

| Module                                   | What it provides                                      |
| ---------------------------------------- | ----------------------------------------------------- |
| `artifact-tracker.ts`                    | `capture()` — snapshot + diff + provenance on change. |
| `snapshot-store.ts`                      | Content-addressed artifact snapshots.                 |
| `diff-engine.ts`                         | Diff computation (the `FileDiff` shape).              |
| `provenance.ts`                          | The task → run → change provenance chain.             |
| `change-status-subscriber.ts`            | Sole writer of `changes.status`.                      |
| `capture/artifact-capture-subscriber.ts` | Listens for artifact events and captures.             |

---

## Interaction with other packages

```text
    agent-runtime ──(artifact.created/changed)──▶ artifact-tracker
    artifact-tracker ──(change.recorded)────────▶ context-engine, embeddings (consume)
```

Single-writer rule: no other package mutates `changes.status`. The tracker
publishes for downstream consumers; it never imports an engine.

---

## Key invariants

- **Single-writer.** `changes.status` has exactly one writer — no concurrent
  partial write is observable.
- **Content-addressed snapshots.** Identical content dedupes; a snapshot is an
  address, not a mutable blob.
- **Provenance-backed diffs.** Every computed diff references the task and run
  that produced it.

---

## Directory structure

```
src/
├── index.ts
├── artifact-tracker.ts
├── snapshot-store.ts
├── diff-engine.ts
├── provenance.ts
├── change-status-subscriber.ts
└── capture/artifact-capture-subscriber.ts
```

## Public API surface

```typescript
// ArtifactTracker (capture), SnapshotStore, DiffEngine (FileDiff),
// Provenance, ChangeStatusSubscriber, ArtifactCaptureSubscriber
// domain re-exports: Artifact, Change, ArtifactSnapshot, FileChange, etc.
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; the capture subscriber is wired to the
`@harness/event-bus`.
