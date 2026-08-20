# Day 20 — Context Engine: Collect, Rank & Budget

| | |
|---|---|
| **Week** | 3 — Trust Pipeline |
| **Spec refs** | Spec 4 §3 (Pipeline), §5 (Ranking — Phase-1 formula), §8 (Tokenizer note) |
| **Estimated effort** | 6 h |
| **Prerequisites** | Day 09 (COLLECT_CONTEXT stub), Day 02 (domain types), Day 13 (SANDBOX_ROOT file access) |

---

## 1. Objectives

1. Implement the **Context Engine Phase 1**: FileCollector → RelevanceRanker → budget trimmer → ContextPackager.
2. Use the **Phase-1 scoring formula** from the spec fix: `relevance_score = 0.7 * keyword_overlap + 0.3 * dependency_proximity` (semantic/recency/history terms fixed at 0 until Phase 3).
3. Enforce the **token budget** via a pluggable `Tokenizer` interface (Phase 1: `chars / 4` estimate).
4. Replace the Day-09 **COLLECT_CONTEXT stub** with the real engine; persist the resulting `ContextSnapshot` for provenance.

> **Why this matters:** "More context is not better — better context is better." An agent fed the whole repo wastes tokens and drifts; an agent fed ranked, budgeted context produces smaller, more verifiable changes — which directly lowers review load downstream.

---

## 2. Design Decisions

### 2.1 Package & types

`packages/context-engine/` (dependency rule R4: imports `@harness/domain`, `@harness/db`, `@harness/di` only — never other engines).

```ts
// packages/context-engine/src/types.ts
export interface Tokenizer { count(text: string): number; }

export class ApproxTokenizer implements Tokenizer {
  // Phase 1 estimate: chars / 4 (Spec 4 §8). Swappable for tiktoken in Phase 2
  // without touching callers — budgets are always interpreted via the request's tokenizer.
  count(text: string): number { return Math.ceil(text.length / 4); }
}

export interface ContextRequest {
  taskId: TaskID;
  taskDescription: string;
  requirements: string;
  targetFiles: string[];        // files explicitly mentioned in the task
  maxTokens: number;            // budget, interpreted via Tokenizer
}

export interface ContextSource {
  type: 'FILE';                 // Phase 1: FILE only (Spec 4 §10)
  sourceId: string;             // repo-relative path
  relevanceScore: number;
  content: string;
  tokenCount: number;
  contentHash: string;          // sha256 — used by Day-21 freshness check
  metadata: Record<string, unknown>;
}

export interface ContextSnapshot {
  id: ContextID;
  taskId: TaskID;
  createdAt: string;
  sources: ContextSource[];     // sorted by relevanceScore desc
  totalTokens: number;
  rankMethod: 'phase1-keyword-dependency';
}
```

### 2.2 Collection (FileCollector)

- Candidate set = `targetFiles` ∪ keyword matches: tokenize `taskDescription + requirements` into lowercase keywords (split on non-alphanumeric, drop stopwords), then scan repo files under the project source dirs for keyword hits in path or content.
- **Exclusions (hard-coded, tested):** `node_modules`, `.git`, `dist`, `build`, binary extensions (`.png .jpg .ico .lock .wasm …`), files > 256 KB.
- File reads go through the same `resolveSafe` path guard as Day-13 tools — the engine never reads outside the project root.

### 2.3 Ranking (Phase-1 formula)

```ts
// packages/context-engine/src/rank.ts — pure functions
export function keywordOverlap(taskKeywords: Set<string>, source: string): number {
  const sourceTokens = tokenize(source);
  if (taskKeywords.size === 0) return 0;
  const hits = [...taskKeywords].filter(k => sourceTokens.has(k)).length;
  return hits / taskKeywords.size;                    // Jaccard-lite, deterministic
}

export function dependencyProximity(path: string, targetFiles: string[]): number {
  if (targetFiles.includes(path)) return 1.0;                       // is a target
  if (targetFiles.some(t => dirname(t) === dirname(path))) return 0.6; // same dir
  if (targetFiles.some(t => importsOf(t).includes(path))) return 0.8;  // imported by target
  return 0.1;
}

// Spec 4 §5 Phase-1 formula — semantic/recency/history are 0 until Phase 3.
export function relevanceScore(kw: number, dep: number): number {
  return 0.7 * kw + 0.3 * dep;
}
```

The formula lives behind a `Ranker` interface so Phase-3 terms activate without changing callers (spec requirement).

### 2.4 Budget trimming (Compressor, Phase-1 = TRUNCATE-only)

Priority rules from Spec 4 §6, in order:
1. **Never remove** a `targetFiles` entry or its content.
2. Sort remaining sources by score desc; drop everything below `minRelevanceThreshold` (default 0.15).
3. Greedily add sources until `maxTokens` would be exceeded; the first source that doesn't fit is **truncated** to the remaining budget (with a `\n… [truncated]` marker); all lower-ranked sources are dropped.
4. `totalTokens` in the snapshot is the **post-trim** count.

### 2.5 Persistence & wiring

Migration `0020_context.sql`:

```sql
CREATE TABLE context_snapshots (
  id           TEXT PRIMARY KEY,               -- UUIDv7
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  rank_method  TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  sources      JSONB NOT NULL                  -- full ContextSource[] incl. content_hash
);
```

Day-09 `COLLECT_CONTEXT` StepHandler replacement:

```ts
const collectContext: StepHandler = async (ctx) => {
  const snapshot = await contextEngine.resolveContext({
    taskId: ctx.task.id,
    taskDescription: ctx.task.description,
    requirements: ctx.task.requirements,
    targetFiles: ctx.task.targetFiles,
    maxTokens: ctx.config.contextMaxTokens ?? 8000,
  });
  return { ok: true, output: { contextSnapshotId: snapshot.id } };
};
```

The snapshot id flows into the EXECUTE step (Day-12 AgentRunner reads it and injects `snapshot.sources` into the system prompt). Step timeout stays 30 s (Day-09 workflow def) — collection is local FS only, so this is generous.

---

## 3. Tasks

- [ ] **3.1** Scaffold `packages/context-engine` (package.json `@harness/context-engine`, tsconfig, boundary tags). (30 min)
- [ ] **3.2** Types + `ApproxTokenizer` + `tokenize`/stopword list. (45 min)
- [ ] **3.3** `FileCollector` with exclusion rules + `resolveSafe` path guard. (1 h)
- [ ] **3.4** Pure rankers (`keywordOverlap`, `dependencyProximity`, `relevanceScore`) + unit tests incl. formula regression (`0.7/0.3` weights). (1 h)
- [ ] **3.5** Budget trimmer implementing the §6 priority rules. (1 h)
- [ ] **3.6** Migration `0020_context.sql` + snapshot persistence. (30 min)
- [ ] **3.7** Replace Day-09 COLLECT_CONTEXT stub; pass snapshot id to EXECUTE; AgentRunner injects sources into prompt. (1 h)
- [ ] **3.8** Integration test: task "Fix bug in PaymentService.ts" → snapshot contains PaymentService.ts, respects budget, excludes node_modules (Spec 4 §11 criteria). (30 min)

---

## 4. Deliverables

| File | Description |
|---|---|
| `packages/context-engine/src/{types,tokenizer,collect,rank,trim,engine}.ts` | Context Engine Phase 1 |
| `packages/context-engine/migrations/0020_context.sql` | context_snapshots table |
| `packages/orchestrator/src/steps/collect-context.ts` | Real COLLECT_CONTEXT handler (replaces stub) |

---

## 5. Acceptance Criteria

- [ ] Given "Fix bug in PaymentService.ts", snapshot includes `PaymentService.ts` with `relevanceScore` ≥ same-directory files.
- [ ] `totalTokens` never exceeds `maxTokens`; over-budget sources are truncated/dropped per §6 rules; target files are never dropped.
- [ ] `node_modules`, `.git`, binaries, and >256 KB files never appear in a snapshot.
- [ ] A task with no explicit files ("Add logging to all API endpoints") still resolves a non-empty, ranked snapshot.
- [ ] Snapshot persisted with `content_hash` per source (Day-21 freshness depends on it).
- [ ] `pnpm test && pnpm lint` green; boundary tests green (context-engine imports no other engine).

---

## 6. Notes & Pitfalls

- **Do not add embeddings "just a little"** — the Phase-1 formula is deliberately keyword-based; premature semantic search adds a model dependency and untestable nondeterminism. The `Ranker` interface is the seam for Phase 3.
- **chars/4 is an estimate, not a lie** — record `rank_method` and tokenizer id in the snapshot so future exact-tokenizer migrations can compare budgets honestly.
- **Keyword matching is case-insensitive and stopword-filtered** — without stopwords, "the"/"a" dominate the overlap score and ranking becomes noise.
- **Collection must stay inside the project root** — reuse Day-13 `resolveSafe`; a context engine that can read `~/.ssh` is a credential-leak vector.
- **Next:** [Day 21 — Context Delivery, Freshness & Week 3 Checkpoint](day-21.md) adds the STALE re-check and the Week-3 go/no-go gate.

---

*Prev: [Day 19 — AttentionPolicy Rules, Routing & Alert Fatigue](day-19.md) | Next: [Day 21 — Context Delivery, Freshness & Week 3 Checkpoint](day-21.md)*
