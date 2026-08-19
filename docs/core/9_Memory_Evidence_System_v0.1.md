# 9. Memory / Evidence System — Specification

**Status:** Draft v0.1
**Phase:** Evidence store ships in Phase 1 (days 04, 17). Knowledge Memory subsystem ships in Phase 3.
**Depends on:** Artifact/Change Tracker (5), Verification Engine (7), Attention Engine (6).

---

## 1. Purpose

Separate two concerns that are often conflated:

- **Evidence** — the immutable, append-only record of *what happened*: test runs, build
  output, tool results, human decisions. Evidence is never edited, only queried.
- **Memory** — curated, retrievable knowledge *derived from* evidence: reusable
  decisions, project conventions, failure patterns. Memory can be summarized, updated,
  and expired.

> **Evidence answers "what exactly occurred?"; Memory answers "what should we recall for future work?"**

The Evaluation Engine (11) consumes both: Evidence is the ground truth for scoring;
Memory is a ranking signal for the Context Engine (4).

---

## 2. Why this split matters

If Memory is treated as "just a vector database over chat logs", the system loses the
distinction between *fact* and *interpretation*. The Harness's first principle is
*evidence before confidence* — so the difference must be structural, not rhetorical.

| | Evidence | Memory |
|---|---|---|
| Mutability | Append-only, immutable | Mutable, expiring |
| Source | Directly observed (tool, test, human action) | Derived, summarized |
| Trust | Ground truth | Heuristic |
| Granularity | Per-event, per-attempt | Aggregated patterns |
| Lifetime | Kept (Phase 1); cold storage (Phase 3) | Expires / consolidates |

---

## 3. Evidence Model (Phase 1)

### 3.1 Evidence record

```ts
type Evidence = {
  id: EvidenceId;
  taskId: TaskId;
  kind: EvidenceKind; // TEST_RUN | BUILD | STATIC_ANALYSIS | TOOL_OUTPUT | HUMAN_DECISION | ...
  claim: ClaimId | null;   // links evidence back to a claim (Spec 7 / Artifact)
  body: EvidenceBody;      // structured: command, result, duration, logs, summary
  producedById?: AgentRunId; // which run produced it
  humanId?: ReviewerId;    // present for HUMAN_DECISION evidence
  occurredAt: Timestamp;
  immutableHash: string;   // content hash to detect tampering
};
```

### 3.2 Invariants

- Never modify an existing evidence record. Corrections are new records referencing the
  original (`supersedes: EvidenceId`).
- Every evidence record links to exactly one `taskId`; provenance must be fully
  queryable (who / what / why / which model / which context).
- `immutableHash` covers the `body`; write path computes it, read path can verify it.

### 3.3 Query surface

- By task, by kind, by artifact/change, by producing agent run.
- `Evidence → Claim` resolution: for any AI claim, enumerate supporting/refuting evidence.
- Day-27 audit queries build on this (correlation-id → task → evidence chain).

---

## 4. Memory Model (Phase 3)

Not built in Phase 1. Kept here so the boundary is explicit and the storage seam
(Postgres) can grow without a rewrite.

### 4.1 Memory kinds (from Architecture §15)

```text
Task Memory · Session Memory · Project Memory · Architecture Memory
· Decision Memory · Failure Memory · Review Memory
```

### 4.2 Memory record (Phase 3 shape, not created in Phase 1)

```ts
type MemoryEntry = {
  id: MemoryId;
  kind: MemoryKind;
  content: string;            // curated summary, not raw log
  sourceEvidence: EvidenceId[]; // always traceable back to evidence
  confidence: number;         // how often this pattern held
  retrievedCount: number;
  lastRetrievedAt: Timestamp | null;
  expiresAt: Timestamp | null;
};
```

### 4.3 Lifecycle rules

- **Creation:** only from evidence (never free-floating AI opinion).
- **Retrieval:** via Context Engine ranking signal, not auto-injection.
- **Update:** consolidation (merge similar entries) is the only allowed mutation.
- **Expiration:** stale knowledge decays; expiry frees budget for Context Engine.

### 4.4 Write-back & versioned memory (Phase 3)

Memory is not a passive read cache. The reference skills framework models it as a
**closed loop**: work produces evidence, evidence is distilled into memory, memory
influences the next context selection, and the outcome is measured so the memory can be
revised. Phase 3 implements that loop with two extra rules on top of §4.3:

```text
        Evidence (9, immutable)
             │  distill (consolidate / summarize)
             ▼
      MemoryEntry vN ──────────────┐
             │  rank signal        │ outcome signal (was it useful?)
             ▼                     ▼
   Context Engine (4) ──► Agent/Run ──► Evaluation Engine (11)
             ▲                             │
             └─────── calibrate ───────────┘
```

- **Write-back is a deliberate, versioned append.** Curating a `MemoryEntry` writes a
  *new version* that supersedes the old one (`supersedes: MemoryId`, mirroring the
  Evidence correction rule in §3.2). The superseded version is kept for audit, never
  mutated in place.
- **Every memory version stays `sourceEvidence`-backed.** A version cannot exist without
  ≥ 1 evidence link — this is the Memory analogue of the "every PASSED report has ≥ 1
  evidence row" invariant and keeps write-back from drifting into unsupported opinion.
- **Write-back is outcome-driven, not auto.** A version is only *eligible* to be promoted
  into the Context Engine rank signal after the Evaluation Engine (11) has observed its
  usefulness (retrievedCount / decision outcomes). Unused or contradicted versions decay
  via expiration rather than being deleted.
- **Promotion is revocable.** A promoted version can be demoted by calibration without
  breaking history, because retrieval always reads "current pointer", not the raw stream.

---

## 5. Phase Boundaries (explicit)

- **Phase 1:** append-only Evidence store (Postgres tables per `day-04.md`), full
  provenance linking (`day-17.md`). No Memory subsystem — query evidence directly.
- **Phase 2:** Evaluation Engine (11) reads evidence to compute pipeline metrics; no
  Memory yet.
- **Phase 3:** Memory subsystem built on top of evidence + evaluation signals. Cold
  storage archival for old evidence (Spec 5 §7 currently warns only on >1MB content).

---

## 6. Success Criteria

- [ ] Every AI claim resolvable to evidence (supporting or refuting) via query.
- [ ] Evidence is immutable at the data layer (no UPDATE path on evidence rows).
- [ ] Provenance chain answers the full audit question for any change.
- [ ] (Phase 3) Memory entries are always traceable to at least one evidence record.