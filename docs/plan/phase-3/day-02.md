# Day 02 — Memory Ingestion: Evidence → Distillation → Versioned Writes

| | |
|---|---|
| **Week** | 1 — Memory store & retrieve |
| **Spec refs** | Spec 9 §4.3 (Lifecycle rules: creation), §4.4 (write-back, outcome-driven), §3 (Evidence model) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 01 (`@harness/memory` package, `memory_entries` + `memory_entry_evidence` schema, `MemoryStore`) |

---

## 1. Objectives

By end of day you will have:

1. An **ingestion listener** that subscribes to evidence-producing events (`verification.completed`, `artifact.merged`, `review.decision_submitted`) and distills them into `MemoryEntry` candidates.
2. A **distillation pipeline** — evidence → summary → candidate — that is deterministic, testable, and never free-floating AI opinion (Spec 9 §4.3: creation *only from evidence*).
3. **Append-only, versioned writes**: curating a candidate writes a *new* version that `supersedes` the previous one, leaving the old row untouched (Spec 9 §4.4).
4. Guardrails that ensure every written version carries ≥ 1 evidence link, and that promotion into the Context rank signal is gated (deferred to Day 04, but the seam is cut today).

This is the "write" half of the closed loop from Spec 9 §4.4: *work produces evidence, evidence is distilled into memory*.

---

## 2. Design Decisions

### 2.1 What gets distilled — an event → kind mapping

Not every event becomes memory. A fixed, auditable mapping decides which events feed which kinds:

| Event (Phase 1/2) | Memory kind | Distillation signal |
|-------------------|-------------|---------------------|
| `review.decision_submitted` (REJECTED/REWORK) | `FAILURE` | rejection rationale + verifying check that failed |
| `review.decision_submitted` (APPROVED) | `DECISION` | what was approved + the pattern that held |
| `verification.completed` (PASSED, `flaky: true`) | `FAILURE` | recurring-flaky test → failure memory |
| `artifact.merged` | `PROJECT` | conventions observed in the merged change |
| `task.completed` | `TASK` | task summary + outcome (for Task Memory) |

**Why a table, not code branches?** The mapping is a policy surface. A `distillation_rules` table (or a versioned TS module) lets Calibration (Day 31) tune *which* evidence becomes memory without editing the listener. Start with a TS constant; promote to a table only if Day 31 needs runtime changes.

### 2.2 Deterministic distillation (`Distiller`)

Distillation summarises evidence into a curated `content` string. It is **not** a free-text "AI opinion" — it is a constrained reduction of evidence fields. Two inputs:

1. **Rule-based summary** (default): pull `check.type`, `file`, `severity`, and `decision.rationale` into a structured sentence. No LLM call.
2. **LLM summary** (optional, behind `LLMProvider`): `summarize(evidence)` for narrative kinds (`PROJECT`, `REVIEW`). Output is **cached and versioned with its prompt hash**, and the `sourceEvidence` ids are always attached — the summary can never outrun its evidence (Spec 9 §4.4).

```typescript
// packages/memory/src/distiller.ts
export interface Distiller {
  distill(events: DomainEvent[], evidence: Evidence[]): Promise<DistillCandidate[]>;
}

export interface DistillCandidate {
  kind: MemoryKind;
  content: string;
  sourceEvidence: EvidenceId[];
  confidence: number;  // initial: 0.5 for rule-based, heuristically lower for LLM-summary
}
```

### 2.3 Versioned, append-only write (subsection of §4.4)

When a new candidate supersedes an existing idea, the write path:

1. Loads the current head of the chain (the entry with no successor).
2. Inserts a **new** `memory_entries` row with `supersedes = head.id`.
3. Copies the head's `sourceEvidence` **plus** the new evidence (union), so the new version is still fully evidence-backed.
4. Publishes `memory.entry_created` with `{ entryId, kind, supersedes }` — the chain is reconstructable from the event log.

Nothing is mutated. The superseded version remains queryable for audit (Spec 9 §4.4: "kept for audit, never mutated in place").

```typescript
// packages/memory/src/ingestion.ts
export class MemoryIngestion {
  constructor(
    private readonly store: MemoryStore,
    private readonly distiller: Distiller,
    private readonly bus: IEventBus,
  ) {}

  async onEvidenceEvents(events: DomainEvent[]): Promise<MemoryEntry[]> {
    const evidence = await this.store.resolveEvidence(events);  // evidence rows backing these events
    const candidates = await this.distiller.distill(events, evidence);
    const created: MemoryEntry[] = [];
    for (const c of candidates) {
      const head = await this.store.findHead(c.kind, c.contentKey); // dedup/similar-match (Day 06 refines)
      created.push(await this.store.create({
        kind: c.kind,
        content: c.content,
        sourceEvidence: head ? union(head.sourceEvidence, c.sourceEvidence) : c.sourceEvidence,
        confidence: c.confidence,
        supersedes: head?.id ?? null,
      }));
    }
    return created;
  }
}
```

### 2.4 Promotion gate is *separate* from write (Spec 9 §4.4)

Writing a version does **not** make it visible to the Context ranker. A version is only *eligible* for promotion after the Evaluation Engine has observed usefulness (`retrievedCount` / decision outcomes). Today we add a `promoted_at`/`is_promoted` marker (nullable) to the model but do **not** implement promotion — that is Day 04's write-back + Day 31's calibration. This separation keeps "stored" and "trusted" distinct.

---

## 3. Tasks

### 3.1 Add `Distiller` (rule-based + optional LLM) (90 min)

- [ ] `packages/memory/src/distiller.ts` — `Distiller` interface, `RuleBasedDistiller` (§2.1 mapping).
- [ ] `RuleBasedDistiller` unit tests: a `verification.completed` (FAILED) event produces a `FAILURE` candidate whose `content` contains the failing file + check + error message.
- [ ] `LLM-backed distiller` behind an `opts.useLLM` flag and `LLMProvider`; each summary writes a `prompt_hash` into metadata (`distill_prompt_hash`). Skeleton only — a real call is optional today, MockLLM suffices for tests.

### 3.2 Extend `MemoryStore` for versioned writes (75 min)

- [ ] `findHead(contentKey)`: returns the entry with `supersedes = NULL` (or the max-`created_at` in the chain) matching a `content_key` hash.
- [ ] `create()` accepts `supersedes` and unions `sourceEvidence` (§2.3).
- [ ] `resolveEvidence(events)`: maps event ids → `evidence` rows (join Phase 1 evidence tables).
- [ ] `promoted_at` column added to schema (migration) with default `NULL`.

### 3.3 Wire the ingestion listener (60 min)

- [ ] `packages/memory/src/ingestion.ts` — `MemoryIngestion.onEvidenceEvents` (§2.3).
- [ ] Subscribe to `verification.completed`, `review.decision_submitted`, `artifact.merged`, `task.completed` in the DI bootstrap (memory does **not** listen to its own events — avoid a feedback loop).
- [ ] Update `docs/architecture/wiring-map.md`.

### 3.4 Evidence-backed invariant tests (60 min)

- [ ] A distilled candidate whose `sourceEvidence` resolves to zero rows is dropped, not written.
- [ ] Writing a superseding version leaves the prior row byte-identical (`supersedes` set, no UPDATE).
- [ ] The new version's `sourceEvidence` = head ∪ new (union, no loss).

### 3.5 Integration test (90 min)

- [ ] Seed a `verification.completed` (FAILED) event + matching evidence row; assert a `FAILURE` memory entry is created and `memory.entry_created` is published.
- [ ] Seed an `APPROVED` decision event; assert a `DECISION` entry with the rationale in `content`.
- [ ] Replay the same evidence twice; assert chain is versioned (second write `supersedes` the first, no mutation).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/src/distiller.ts` | `Distiller`, `RuleBasedDistiller`, (optional) LLM distiller |
| `packages/memory/src/ingestion.ts` | `MemoryIngestion` event listener |
| `packages/memory/src/memory-store.ts` (updated) | `findHead`, `resolveEvidence`, union write |
| `packages/db/src/schema/memory.ts` (updated) + migration | `promoted_at` column |
| `packages/memory/src/__tests__/*.test.ts` | Distiller, ingestion, invariant tests |
| `docs/architecture/wiring-map.md` (updated) | Ingestion subscriptions |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/memory test` — all tests pass.
- [ ] A FAILED verification event + evidence row produces exactly one `FAILURE` memory entry.
- [ ] An APPROVED decision event produces a `DECISION` entry whose `content` includes the approval rationale.
- [ ] Re-running ingestion for the same evidence creates a new superseding version (no in-place UPDATE — prove via `SELECT count(*)` and `supersedes`).
- [ ] No memory entry is written when it links to zero evidence rows.
- [ ] Every created entry publishes `memory.entry_created` with `supersedes` field.
- [ ] `promoted_at` defaults NULL for all writes today.
- [ ] `grep -r "from '@harness" packages/memory/src` still shows only the four allowed packages (no `context-engine` import; promotion is a cross-package concern deferred to DI/events).

---

## 6. Notes & Pitfalls

- **Distillation must remain reduction, not invention.** If the rule-based distilled `content` cannot be assembled from fields present on the evidence (e.g. there is no `rationale`), emit a structured placeholder — do **not** have the LLM "fill in" a plausible rationale. That is exactly the drift Spec 9 §4.4 warns against.
- **Do not listen to `memory.entry_created`.** Ingestion feeds off *evidence-producing* events only. Listening to memory's own events creates an infinite loop that keeps writing versions.
- **Union, never replace, `sourceEvidence`.** Replacing evidence links on supersession would orphan the earlier evidence and break the "every version stays evidence-backed" invariant at the chain level.
- **Version chain head lookups get slow if unbounded.** `findHead` by `content_key` uses the `supersedes_idx` from Day 01. If the chain grows large, Day 06's consolidation is the control — do not add a `MAX(supersedes)` scan on the hot path.
- **LLM distillation is optional today.** MockLLM is fine; the point is the `prompt_hash` metadata so Day 28's judge audit and Day 31's calibration can reproduce a summary. Do not spend the day tuning prompts.
- **Tomorrow (Day 03):** retrieval — the `0.6·sim + 0.2·recency + 0.2·access` relevance scoring served to the Context Engine.

---

*Prev: [Day 1 — Memory Model v2: Seven Tiers](day-01.md) | Next: [Day 3 — Memory Retrieval: Relevance Scoring Served to Context](day-03.md)*
