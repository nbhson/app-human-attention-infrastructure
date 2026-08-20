# Day 11 — tree-sitter Symbol Index: Functions/Classes/Imports

| | |
|---|---|
| **Week** | 3 — Dependency graph → targeted verify |
| **Spec refs** | Spec 7 §5.2–5.3 (targeted/incremental verification needs a code index), Spec 4 §4.1–4.2 (file scanner / symbol resolver) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 10 (Week 2 checkpoint — memory + trajectory foundation clean) |

---

## 1. Objectives

By end of day you will have:

1. A new package `packages/code-index` (`@harness/code-index`) that parses the target repo into symbols via **tree-sitter**.
2. Symbol extraction for **functions, classes/methods, and imports** (TS/JS first; the grammar set is language-swappable).
3. A persisted **symbol index** in Postgres (`symbols`, `file_symbols`/`imports` tables) consumable by the graph builder (Day 12) and the Context Engine's Symbol Resolver (Spec 4 §4.2).
4. A re-index trigger hooked to `artifact.changed`/checkout events, with a staleness marker for un-indexed checkouts.

This is the read/parse layer the dependency graph (Day 12) and targeted verification (Day 14) stand on.

---

## 2. Design Decisions

### 2.1 tree-sitter as the parser (not regex)

The Phase 1 Context Engine used regex-based symbol resolution (Spec 4 §10 "Phase 2: Symbol Resolution … simple regex-based parsing"). Day 11 replaces it with **tree-sitter** grammars (a `tree-sitter` + `tree-sitter-typescript`/`tree-sitter-javascript` install) for structured, unambiguous symbol extraction. Regex stays only as a last-resort fallback.

```typescript
// packages/code-index/src/parser.ts
export interface SymbolIndexer {
  indexFile(path: string, source: string): Promise<FileSymbols>;
}

export interface FileSymbols {
  path: string;
  functions: SymbolDef[];     // { name, range: [start,end], signature }
  classes:   SymbolDef[];     // + methods
  imports:   ImportEdge[];    // { from: path (resolved), symbols: string[] }
}
```

### 2.2 Symbol schema (Postgres)

```typescript
// packages/db/src/schema/code-index.ts
export const symbols = pgTable('symbols', {
  id:            text('id').primaryKey(),           // SHA256(path + name + range)
  project_id:    text('project_id').notNull(),
  path:          text('path').notNull(),
  name:          text('name').notNull(),
  kind:          text('kind').notNull(),            // 'function' | 'class' | 'method' | 'import'
  signature:     text('signature'),
  range_start:   integer('range_start').notNull(),
  range_end:     integer('range_end').notNull(),
  content_hash:  text('content_hash').notNull(),    // source file hash at index time
  indexed_at:    timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pathIdx:   index('symbols_path_idx').on(t.path),
  nameIdx:   index('symbols_name_idx').on(t.name),
  kindIdx:   index('symbols_kind_idx').on(t.kind),
}));

export const fileImports = pgTable('file_imports', {
  id:        text('id').primaryKey(),
  project_id: text('project_id').notNull(),
  importer:  text('importer').notNull(),            // file path
  imported:  text('imported').notNull(),            // resolved module/file path
  symbols:   text('symbols').notNull(),             // JSON array of imported symbols
}, (t) => ({
  importerIdx: index('file_imports_importer_idx').on(t.importer),
  importedIdx: index('file_imports_imported_idx').on(t.imported),
}));
```

### 2.3 Staleness model (checkout changes must invalidate)

The index is a snapshot of a checkout. A `content_hash` per file is computed at index time; a re-checkout that changes a file makes its symbols stale until re-indexed.

```typescript
interface IndexStatus {
  path: string;
  contentHash: string;
  stale: boolean;     // true when current on-disk hash != indexed content_hash
}
```

- Index rows are never edited in place on staleness — a re-index writes new rows keyed by the new `content_hash`/`range` (content-addressed id), and old rows are superseded.
- A "stale" symbol is simply not returned by `lookupSymbol` until re-indexed (mirrors Spec 4 §8 freshness rule: stale → cache miss, never poisoned).

### 2.4 Package boundary

`@harness/code-index` imports only `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di`. It is consumed by `verification-engine` (Day 14 targeted selection) and `context-engine` (symbol resolution) **via DI-resolved interfaces**, never direct imports. Add to the boundary rules + architecture test.

### 2.5 Incremental (re-)indexing scope

Today indexes the whole target repo once + a single-file re-index path. Day 13–14 will consume per-file changes. Keep `indexFile(path)` as the primitive so incremental indexing is already shaped correctly.

---

## 3. Tasks

### 3.1 Scaffold `packages/code-index` (30 min)

- [ ] `package.json` (`tree-sitter`, `tree-sitter-typescript`, `tree-sitter-javascript` deps), `tsconfig.json`, barrel.
- [ ] Add to boundary configuration + architecture test list.

### 3.2 Parser + symbol extraction (150 min)

- [ ] `packages/code-index/src/parser.ts` — `TreeSitterIndexer.indexFile()` returning `FileSymbols` (§2.1).
- [ ] Extract functions, classes (with methods), and imports; record `range_start/end`.
- [ ] Resolve relative import paths to repo-relative file paths (for `file_imports.imported`).

### 3.3 Schema + migration (45 min)

- [ ] `packages/db/src/schema/code-index.ts` (§2.2); generate + migrate.

### 3.4 `SymbolIndex` store + staleness (90 min)

- [ ] `packages/code-index/src/symbol-index.ts` — `indexProject(repoPath)`, `indexFile(path)`, `lookupSymbol(name)`, `isStale(path, currentHash)`.
- [ ] Compute `content_hash` (SHA256 of file bytes) at index time; content-addressed symbol ids.

### 3.5 Re-index trigger (45 min)

- [ ] Subscribe to `artifact.changed` (Phase 1 event) to re-index the changed file.
- [ ] Publish `code_index.file_indexed { path, symbolCount, contentHash }`.

### 3.6 Tests (120 min)

- [ ] A fixture `.ts` file produces expected functions/classes/imports (golden symbol set).
- [ ] `lookupSymbol('PaymentService')` returns the class definition + path.
- [ ] `isStale` returns true after the file hash changes, false after re-index.
- [ ] Import edge resolution maps `./payment` → `src/payment.ts`.
- [ ] Boundary test: `@harness/code-index` imports only the four allowed packages.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/code-index/package.json` + `tsconfig.json` + barrel | New package |
| `packages/code-index/src/parser.ts` | `TreeSitterIndexer` |
| `packages/code-index/src/symbol-index.ts` | `SymbolIndex` store + staleness |
| `packages/db/src/schema/code-index.ts` | `symbols` + `file_imports` |
| `packages/code-index/src/__tests__/*.test.ts` | Golden symbol tests + boundary |
| `apps/api/src/bootstrap.ts` (updated) | `SymbolIndex` DI registration |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/code-index test` — all tests pass.
- [ ] A golden fixture `.ts`/.js file indexes with the exact expected function/class/import set.
- [ ] `symbols` and `file_imports` tables exist and are populated by `indexProject`.
- [ ] Symbol ids are content-addressed (`SHA256(path+name+range)`), so re-indexing a changed file writes new rows, never edits old ones.
- [ ] `lookupSymbol(name)` returns stale-free results only.
- [ ] `artifact.changed` re-indexes the touched file (spy/integration test).
- [ ] `grep -r "from '@harness" packages/code-index/src` shows only `@harness/{domain,event-bus,db,di}`.
- [ ] `pnpm lint` clean.

---

## 6. Notes & Pitfalls

- **tree-sitter grammar version pinning.** `tree-sitter-typescript` and `tree-sitter` have version-locked ABIs; pin exact versions and test the parse on a real `.ts` file early — a mismatched grammar produces empty parses that look like "no symbols," not an error.
- **Import resolution is the hard 20%.** `./`, `../`, barrel files, path aliases (`@/`), and node_modules all resolve differently. Start with relative-path resolution and record unresolved imports as rows with `imported = null` — do **not** silently drop them (the graph builder needs to know what it couldn't resolve).
- **Staleness on checkout is the trap.** If the repo is re-checked out and the index isn't invalidated, Day 14 targeted verification will select tests against a graph of *yesterday's* symbols — the false-negative risk called out for the whole week. Make `content_hash` comparison the source of truth.
- **Regex is now a fallback, not the front line.** The Phase 1 `SymbolCollector` regex path stays for parse failures, but the happy path is tree-sitter. Do not keep two "sources of truth" for symbols.
- **Content-addressed ids mean growth.** Repeated re-indexes accumulate superseded symbol rows. Reuse the Day 06/07 consolidation mindset — but for the index, superseded rows can be *pruned* (they are derived data, not evidence). Defer actual GC to Week 8; just note it now.
- **Tomorrow (Day 12):** dependency graph build (file/module edges) in Postgres, consuming today's symbols + imports.

---

*Prev: [Day 10 — Week 2 Checkpoint: Consolidation/Decay Validated Against the Decision Log](day-10.md) | Next: [Day 12 — Dependency Graph Build (File/Module Edges) in Postgres](day-12.md)*
