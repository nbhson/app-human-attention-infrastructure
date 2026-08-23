# Day 17 — Evidence storage + provenance linking + diff engine

| | |
|---|---|
| **Week** | W3 — Trust pipeline |
| **Spec refs** | Spec 9 §1 (evidence/memory), Spec 1 §4/§7 (evidence + provenance) |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 15–16 (checks produce results) |

---

## 1. Objectives

- Persist verification `CheckResult`s as **append-only evidence** rows linked back to the review/task via `correlation_id`.
- Build the **diff engine** (`@harness/artifact-tracker`'s change capture) that fingerprints a PR's content and records change versions, so evidence always points at the exact code it verified.
- Establish provenance linking: `fetch → review → evidence → decision` queried through one chain, with no orphaned evidence.
- Keep the evidence store append-only (no UPDATE/DELETE), preserving Spec 9's "evidence before confidence".

## 2. Design Decisions

- The diff engine is read-only: it captures the change (file set, hunks, content hash), never writes back to the repo.

```ts
export interface ChangeArtifact {
  readonly id: ChangeID;
  readonly prUrl: string;
  readonly fileSet: string[];     // repo-relative paths touched
  readonly contentHash: string;   // SHA-256 of normalized diff
  readonly baseRef: string;
  readonly headRef: string;
}
```

- Every evidence row stores the `contentHash` it verified, so a stale review (code since changed) is detectable — a check result is a *claim about a specific content version*, not about "the repo".

## 3. Tasks

### 3.1 Evidence persistence (150 min)
- [ ] `@harness/db` `evidence` repository + schema (append-only)
- [ ] `verification-engine` result → evidence binding with `correlation_id` + `contentHash`

### 3.2 Diff engine (180 min)
- [ ] `@harness/artifact-tracker` change capture: file set, hunk structure, SHA-256 normalized hash
- [ ] Change versioning (same PR, new head → new `contentHash`)

### 3.3 Provenance + tests (120 min)
- [ ] Query joining review → evidence → decision; unit + integration tests; orphaned-evidence guard

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/evidence.ts` | Append-only evidence schema |
| `packages/db/src/repositories/evidence.ts` | Evidence access |
| `packages/artifact-tracker/src/diff-engine.ts` | Change capture + hash |
| `packages/artifact-tracker/src/change-store.ts` | Change versioning |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/verification-engine test` and `--filter @harness/artifact-tracker test` pass
- [ ] A `CheckResult` persists with its `contentHash` and `correlation_id`
- [ ] Changing one hunk changes the `contentHash`; unchanged content keeps a stable hash
- [ ] Provenance query returns `fetch → report → evidence → decision` with no orphans under one correlation

## 6. Notes & Pitfalls

- Normalize the diff (strip index lines/timestamps) before hashing or the hash changes spuriously on every fetch.
- Evidence is a *record*, never mutated; a fresh verification creates a new row pointing at new content.

---

*Next: [Day 18 — Attention Engine scoring (Risk/Impact/Novelty/Complexity/Confidence)](day-18.md)*