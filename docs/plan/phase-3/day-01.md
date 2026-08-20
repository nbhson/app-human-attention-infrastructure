# Day 01 — Memory Model v2: Seven Tiers

| | |
|---|---|
| **Week** | 1 — Memory store & retrieve |
| **Spec refs** | Spec 9 §4.1 (Memory kinds), §4.2 (Memory record), §4.3 (Lifecycle rules), §3.2 (Evidence invariants) |
| **Estimated effort** | 7h |
| **Prerequisites** | Phase 2 complete (`v0.2.0-harness`): evidence store, `pgvector` + `Embedder` (shadow), calibration, A/B harness |

---

## 1. Objectives

By end of day you will have:

1. A new package `packages/memory` (`@harness/memory`) scaffolded with the correct dependency boundary (never imports another engine package).
2. The **seven memory kinds** from Spec 9 §4.1 typed and enforced in the domain layer: `TASK`, `SESSION`, `PROJECT`, `ARCHITECTURE`, `DECISION`, `FAILURE`, `REVIEW`.
3. A `MemoryEntry` domain model matching Spec 9 §4.2, plus the `supersedes` field Spec 9 §4.4 will need (laid in the schema now so Day 04 needs no migration).
4. Postgres schema for `memory_entries` and a `memory_entry_evidence` join table, migrated through `@harness/db`.
5. A DI registration (`TOKENS.MemoryStore`) and the first architecture test proving the boundary.

This day establishes the **model and storage seam**. Days 02–04 build ingestion, retrieval, and versioned write-back on top of it.

---

## 2. Design Decisions

### 2.1 Seven kinds, one table, a `kind` discriminator

Spec 9 §4.1 names seven kinds; Spec 9 §4.2 gives each the *same* base shape (`content`, `confidence`, `sourceEvidence`, `retrievedCount`, …). So use **one `memory_entries` table** with a `kind` enum and a `metadata jsonb` for kind-specific fields — not seven tables.

```typescript
// packages/domain/src/memory.ts
export const MemoryKind = {
  TASK:         'TASK',
  SESSION:      'SESSION',
  PROJECT:      'PROJECT',
  ARCHITECTURE: 'ARCHITECTURE',
  DECISION:     'DECISION',
  FAILURE:      'FAILURE',
  REVIEW:       'REVIEW',
} as const;
export type MemoryKind = typeof MemoryKind[keyof typeof MemoryKind];

export type MemoryId = string & { readonly __brand: 'MemoryId' };
```

**Why one table?** Retrieval (Day 03) scores across all kinds at once; a UNION across seven tables would make every query and every relevance ranking a special case. Kind-specific joins live in `metadata jsonb` (rarely queried directly) or in a dedicated column only when a field is shared AND queried (e.g. `supersedes`).

### 2.2 `MemoryEntry` domain shape (Spec 9 §4.2 + §4.4 field)

```typescript
// packages/domain/src/memory.ts (continued)
export interface MemoryEntry {
  id:               MemoryId;
  kind:             MemoryKind;
  content:          string;              // curated summary, NOT raw log
  sourceEvidence:   EvidenceId[];        // ≥ 1 invariant — see §2.4
  confidence:       number;              // [0,1] — how often the pattern held
  retrievedCount:   number;              // access counter (Day 03 scoring)
  lastRetrievedAt:  Date | null;
  expiresAt:        Date | null;         // null = no scheduled expiry
  supersedes:       MemoryId | null;     // version chain (Day 04 write-back)
  createdAt:        Date;
}
```

`supersedes` mirrors the Evidence correction rule in Spec 9 §3.2 (`supersedes: EvidenceId`). It is **nullable** — the first write of a memory idea has no predecessor; later writes form a Git-like chain (Day 04).

### 2.3 DB schema (Drizzle, in `@harness/db`)

```typescript
// packages/db/src/schema/memory.ts
import { pgTable, pgEnum, text, integer, real, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const memoryKind = pgEnum('memory_kind', ['TASK','SESSION','PROJECT','ARCHITECTURE','DECISION','FAILURE','REVIEW']);

export const memoryEntries = pgTable('memory_entries', {
  id:               text('id').primaryKey(),
  kind:             memoryKind('kind').notNull(),
  content:          text('content').notNull(),
  confidence:       real('confidence').notNull().default(1.0),
  retrieved_count:  integer('retrieved_count').notNull().default(0),
  last_retrieved_at: timestamp('last_retrieved_at', { withTimezone: true }),
  expires_at:       timestamp('expires_at', { withTimezone: true }),
  supersedes:       text('supersedes'),   // self-FK added below (avoid circular table def)
  created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  kindIdx:        index('memory_kind_idx').on(t.kind),
  retrievedIdx:   index('memory_retrieved_idx').on(t.retrieved_count),
  supersedesIdx:  index('memory_supersedes_idx').on(t.supersedes),
  expiresIdx:     index('memory_expires_idx').on(t.expires_at),
}));

export const memoryEntryEvidence = pgTable('memory_entry_evidence', {
  memory_id:  text('memory_id').notNull().references(() => memoryEntries.id),
  evidence_id: text('evidence_id').notNull(),  // FK into evidence store
}, (t) => ({
  pk: { name: 'memory_entry_evidence_pk', columns: [t.memory_id, t.evidence_id] },
  evidenceIdx: index('memory_evidence_idx').on(t.evidence_id),
}));
```

- `content` is text, not jsonb: the curated summary is the searchable unit (Day 03 embeds/lexically indexes it).
- `retrieved_count` / `last_retrieved_at` are first-class columns because they are read on every retrieval-scoring query (§4.2, §4.5) — not buried in jsonb.

### 2.4 The ≥ 1 evidence invariant (Spec 9 §4.4, §6)

A `MemoryEntry` **cannot exist without ≥ 1 `sourceEvidence` link** — the Memory analogue of "every PASSED report has ≥ 1 evidence row". Enforce it twice:

1. **At write time** in `MemoryStore.create()` (reject `sourceEvidence.length === 0`).
2. **At read time** — the retrieval path filters entries with zero links out of candidates.

Do **not** rely on a DB trigger yet; the app-layer check plus the join table's FK is enough and keeps the invariant visible in code (a trigger hides it).

### 2.5 Dependency boundary (the R4 rule extended)

`@harness/memory` imports only `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`. It **never imports** `context-engine`, `attention-engine`, or any other engine. Memory is *consumed by* Context (Day 03) via the event bus and a callback/resolver registered in DI — not by direct import. Add `memory` to the `eslint-plugin-boundaries` engine pattern (it already matches `packages/*`; verify the architecture test lists it).

---

## 3. Tasks

### 3.1 Scaffold `packages/memory` (30 min)

- [ ] `packages/memory/package.json` — name `@harness/memory`; deps: `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di` (all `workspace:*`).
- [ ] `packages/memory/tsconfig.json` (extends root base), `src/index.ts` barrel.
- [ ] Add `memory` to `apps/api/package.json` deps and to the boundary configuration.

### 3.2 Domain types in `@harness/domain` (45 min)

- [ ] `packages/domain/src/memory.ts` — `MemoryKind`, `MemoryId`, `MemoryEntry` (§2.1–2.2).
- [ ] Add `MemoryId`, `MemoryKind` to the domain barrel.
- [ ] Unit test: `MemoryKind` has exactly 7 members (fail if someone adds/removes one silently).

### 3.3 Schema + migration (45 min)

- [ ] `packages/db/src/schema/memory.ts` (§2.3) — `memoryEntries`, `memoryEntryEvidence`.
- [ ] Add self-FK on `supersedes` via an `ALTER TABLE` in the migration SQL (`memory_entries.supersedes → memory_entries.id`, `ON DELETE RESTRICT`).
- [ ] `pnpm --filter @harness/db generate` → review → `migrate`.

### 3.4 `MemoryStore` core (120 min)

- [ ] `packages/memory/src/memory-store.ts`:

```typescript
export class MemoryStore {
  constructor(private readonly db: DrizzleDB, private readonly bus: IEventBus) {}

  async create(input: CreateMemoryInput): Promise<MemoryEntry> {
    // 1. Validate kind + content non-empty
    // 2. Validate sourceEvidence.length >= 1 (throw MissingEvidenceError)
    // 3. Insert memory_entries row (id = uuidv7())
    // 4. Insert memory_entry_evidence rows
    // 5. Publish memory.entry_created { entryId, kind, supersedes: null }
    // 6. Return entry
  }

  async getById(id: MemoryId): Promise<MemoryEntry | null> { /* join evidence */ }
  async listByKind(kind: MemoryKind): Promise<MemoryEntry[]> { ... }
}
```

- [ ] `CreateMemoryInput` = `Omit<MemoryEntry, 'id' | 'createdAt' | 'retrievedCount' | 'lastRetrievedAt'>`.
- [ ] Errors: `MissingEvidenceError`, `InvalidMemoryKindError`.

### 3.5 DI + wiring (45 min)

- [ ] Add `MemoryStore` to `TOKENS` in `packages/di/src/tokens.ts`.
- [ ] Register in `apps/api/src/bootstrap.ts`: `new MemoryStore(c.resolve(TOKENS.Db), c.resolve(TOKENS.EventBus))`.
- [ ] Update `docs/architecture/wiring-map.md` with the new token.

### 3.6 Tests (135 min)

- [ ] `create()` persists a row with correct `kind`, `content`, `confidence` default 1.0.
- [ ] `create()` with empty `sourceEvidence` throws `MissingEvidenceError`.
- [ ] `create()` publishes `memory.entry_created` (spy on bus) with the entry id.
- [ ] `getById` returns `sourceEvidence` links; missing id returns `null`.
- [ ] `listByKind('DECISION')` returns only DECISION entries.
- [ ] Architecture test: `packages/memory/package.json` dependencies contain zero engine packages (only domain/event-bus/db/di).
- [ ] `grep -r "from '@harness" packages/memory/src` shows only the four allowed packages.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/memory/package.json` + `tsconfig.json` + `src/index.ts` | New `@harness/memory` package |
| `packages/domain/src/memory.ts` | `MemoryKind`, `MemoryId`, `MemoryEntry` |
| `packages/db/src/schema/memory.ts` | `memory_entries` + `memory_entry_evidence` |
| `packages/db/migrations/0xxx_memory.sql` | Migration (incl. `supersedes` self-FK) |
| `packages/memory/src/memory-store.ts` | `MemoryStore.create/getById/listByKind` |
| `packages/memory/src/errors.ts` | `MissingEvidenceError`, `InvalidMemoryKindError` |
| `apps/api/src/bootstrap.ts` (updated) | `TOKENS.MemoryStore` registration |
| `packages/memory/src/__tests__/*.test.ts` | Domain + store + boundary tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/memory test` — all tests pass.
- [ ] `pnpm --filter @harness/memory build` — clean build.
- [ ] `pnpm lint` — zero boundary violations (memory listed as an engine).
- [ ] `memory_entries` and `memory_entry_evidence` exist in the DB (`psql \d memory_entries`).
- [ ] `supersedes` column exists and is `NULL`-able with a self-FK.
- [ ] Creating a `MemoryEntry` with zero evidence links is impossible (test proves the throw).
- [ ] `memory.entry_created` event is published with `kind` and entry id.
- [ ] `grep -r "from '@harness" packages/memory/src` shows only `@harness/{domain,event-bus,db,di}`.
- [ ] `docs/architecture/wiring-map.md` lists `TOKENS.MemoryStore`.

---

## 6. Notes & Pitfalls

- **This is the model day — do not build retrieval or write-back.** Those are Days 03–04. Keep today to schema + create/get/list so the checkpoint (Day 05) has a clean foundation.
- **Seven kinds, not six.** The plan table collapses the list for brevity, but Spec 9 §4.1 includes `ARCHITECTURE`. Omitting it now means re-adding a `kind` enum value later (a migration for no reason).
- **`supersedes` in the schema today.** Laying the column now avoids a Day 04 migration and lets the version-chain index exist from the first insert. Do not implement the write-back *logic* yet — just the column + self-FK.
- **Evidence FKs.** Confirm the actual evidence table/column name in `@harness/db` (Phase 1 day-17) before writing the join FK; if the evidence id column is named differently, match it. The `memory_entry_evidence.evidence_id` FK must target the real evidence PK or provenance breaks.
- **`sourceEvidence` as join table vs `uuid[]`.** A join table keeps "which evidence backs which memory" queryable from the evidence side too (Spec 9 §4.4 requires every version stay `sourceEvidence`-backed). Do not collapse it into a jsonb array.
- **Tomorrow (Day 02):** ingestion — evidence → distillation → versioned append. Today's `create()` is the low-level write; Day 02 wraps it in the distillation pipeline.

---

*Next: [Day 2 — Memory Ingestion: Evidence → Distillation → Versioned Writes](day-02.md)*
