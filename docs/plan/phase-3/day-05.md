# Day 05 — Week 1 Checkpoint: Memory Write + Read Demonstrable

| | |
|---|---|
| **Week** | 1 — Memory store & retrieve |
| **Spec refs** | Spec 9 §4 (Memory model), §4.4–4.5 (write-back + retrieval) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 04 (versioned write-back, rollback, forget, cross-checks) |

---

## 1. Objectives

This is a **hard checkpoint**, not a build day. No new features. By end of day you will have:

1. A passing **end-to-end memory demo**: evidence in → memory written (versioned) → memory retrieved by relevance → surfaced in a Context snapshot → counters updated.
2. A **smoke test** that exercises the full Memory loop against a real Postgres instance and the real `InProcessEventBus`.
3. A **Week 1 retrospective note** (§5 structure) capturing what is solid and what is fragile before Week 2 (consolidation/decay/archive).
4. Confidence that "write + read" is demonstrable per the W1 milestone.

**Do not proceed to Day 06 until every acceptance criterion in §5 is green.**

---

## 2. What Week 1 Has Built

| Component | Package | Status |
|-----------|---------|--------|
| Seven memory kinds + domain model | `@harness/domain` / `@harness/memory` | ✅ Day 01 |
| `memory_entries` + `memory_entry_evidence` schema | `@harness/db` | ✅ Day 01 |
| Distillation (evidence → candidates) | `@harness/memory` | ✅ Day 02 |
| Versioned append-only ingestion | `@harness/memory` | ✅ Day 02 |
| Relevance scoring (0.6/0.2/0.2) + retrieval | `@harness/memory` | ✅ Day 03 |
| Context seam (`MemorySignalSource`) | `@harness/domain` / `@harness/context-engine` | ✅ Day 03 |
| Write-back: `supersedes`, rollback, forget, cross-checks | `@harness/memory` | ✅ Day 04 |

---

## 3. Tasks

### 3.1 Write the Memory E2E smoke test (150 min)

File: `apps/api/src/__tests__/week1-memory-smoke.test.ts`

Runs against the real `harness_test` schema and the real `InProcessEventBus`. No mocks except a deterministic `Embedder` (or lexical fallback).

```typescript
describe('Week 1 Memory Smoke Test', () => {
  it('evidence → write → retrieve → context, versioned and counted', async () => {
    const c = buildContainer();
    const bus       = c.resolve<IEventBus>(TOKENS.EventBus);
    const memory    = c.resolve<MemorySignalSource>(TOKENS.MemoryStore);
    const ingestion = c.resolve<MemoryIngestion>(TOKENS.MemoryIngestion);

    // 1. Seed evidence + a FAILED verification event
    const ev = await seedVerificationFailed('auth/login.ts', 'TEST', 'TypeError');
    await ingestion.onEvidenceEvents([ev]);

    // 2. Memory exists, evidence-backed
    const failure = await memory.retrieve('auth login test failure', 'FAILURE', 5);
    expect(failure).toHaveLength(1);
    expect(failure[0].sourceEvidence.length).toBeGreaterThanOrEqual(1);

    // 3. Versioned: re-ingest → supersedes forms
    await ingestion.onEvidenceEvents([ev]);
    const head = await getHead(failure[0].contentKey);
    expect(head.supersedes).not.toBeNull();

    // 4. Retrieval bumps the counter
    const before = head.retrievedCount;
    await memory.retrieve('auth login test failure', 'FAILURE', 5);
    expect((await getHead(failure[0].contentKey)).retrievedCount).toBe(before + 1);

    // 5. Surfaces in Context when policy allows
    const ctx = await c.resolve<IContextEngine>(TOKENS.ContextEngine).resolveContext({
      /* task targeting auth/login.ts, include_previous_decisions: true */
    });
    expect(ctx.sources.some(s => s.type === 'DECISION' || s.type === 'EVIDENCE')).toBe(true);
  });
});
```

- [ ] All smoke assertions pass against `harness_test` schema.
- [ ] Teardown drops/recreates `harness_test` cleanly.

### 3.2 Wire the demo path in bootstrap + API (60 min)

- [ ] Confirm `TOKENS.MemoryStore`, `TOKENS.MemoryIngestion`, `TOKENS.MemoryWriteBack` all resolve in `buildContainer()`.
- [ ] Add two debug endpoints (dev only) to `apps/api`: `GET /debug/memory?q=&kind=` (retrieve) and `GET /debug/memory/:id/chain` (version log). Mark them non-production in the route comment.

### 3.3 Fix outstanding lint/type/boundary issues (as needed, 60 min)

- [ ] `pnpm lint` — zero errors/warnings.
- [ ] `pnpm -r typecheck` — zero errors.
- [ ] Verify `grep -r "from '@harness" packages/memory/src` still shows only the four allowed packages.

### 3.4 Write Week 1 retro (45 min)

File: `docs/retros/week-01-phase3.md` (`# Week 1 Phase 3 Retro — Memory store & retrieve`), with the standard sections:

```
## What is solid
## What is fragile
## Decisions that need revisiting before Week 4 (hybrid cutover)
## Watch items for Week 2 (consolidation/decay/archive)
```

Prompts: Is the `0.6/0.2/0.2` weighting behaving well with the lexical fallback? Is `supersedes`-chain retrieval fast enough? Does the `MemorySignalSource` seam feel clean from the Context side? Any write-back cross-check that felt missing?

### 3.5 Update wiring map + README (30 min)

- [ ] `docs/architecture/wiring-map.md` — all Memory tokens listed.
- [ ] `README.md` (root) — add "Phase 3 Week 1 Status" note.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/__tests__/week1-memory-smoke.test.ts` | Memory E2E smoke test |
| `apps/api/src/bootstrap.ts` (updated) | Full Memory wiring confirmed |
| `apps/api/src/routes/debug.ts` (dev-only) | Memory debug endpoints |
| `docs/retros/week-01-phase3.md` | Retrospective |
| `README.md` (updated) | Week 1 status section |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/memory test` — all tests pass.
- [ ] Memory smoke test passes: evidence → versioned write → relevance retrieve → context surface → counter bump.
- [ ] `pnpm lint` — zero errors; `pnpm -r typecheck` — zero errors.
- [ ] `grep -r "from '@harness" packages/memory/src` shows only `@harness/{domain,event-bus,db,di}`.
- [ ] No `UPDATE` on `content`/`confidence`/`sourceEvidence` anywhere in `packages/memory` (all writes append).
- [ ] Retrieval returns only current (head) versions.
- [ ] `docs/retros/week-01-phase3.md` exists and names real fragility.
- [ ] The W1 milestone is demonstrable from the debug endpoint: write a memory from evidence, read it back ranked.

**Checkpoint rule:** If any criterion is red, stop. Fix it today. Do not carry a red Memory foundation into Week 2.

---

## 6. Notes & Pitfalls

- **The smoke test is the deliverable.** "We built Memory" is meaningless until the write→read loop runs against Postgres + the real bus in one test.
- **Lexical fallback makes retrieval slightly nondeterministic across entries with equal Jaccard.** If the smoke test flakes on ordering, compare *sets and relative order for clearly-different scores*, not exact index positions for near-ties.
- **`harness_test` residue.** The supersedes-counter assertions depend on a clean schema each run. Drop + recreate, don't truncate, or `retrieved_count` drifts across runs.
- **Debug endpoints are dev-only.** Do not let `GET /debug/memory` ship to the review UI or production routes. Mark them clearly; Week 8 hardening removes or gates them behind auth.
- **Do not start consolidation (Day 06) today.** The temptation to "quickly add dedup threshold" while the smoke test is green is real. A clean checkpoint is worth more than a head start — consolidation changes retrieval semantics and needs its own day.
- **Tomorrow (Day 06):** consolidation — dedup (0.85), conflict strategy, decay (`0.99^days`).

---

*Prev: [Day 4 — Versioned Write-back: supersedes, Rollback, Forget/Update Cross-check](day-04.md) | Next: [Day 6 — Consolidation: Dedup (0.85), Conflict Strategy, Decay (0.99^days)](day-06.md)*
