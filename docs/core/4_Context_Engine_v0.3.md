# Context Engine
## Specification v0.3 – Selecting and Preparing Context for AI Agents

**Status:** Draft v0.3  
**Dependencies:** Architecture (`HAI_Harness_Architecture_v0.2.md`), Task Orchestrator (`Task_Work_Orchestrator_v0.3.md`)  
**Purpose:** Define how the Harness selects, ranks, compresses, and delivers relevant context to AI Agents — ensuring Agents receive the right information without overwhelming the model's context window.

---

# 1. Purpose

The Context Engine is responsible for deciding **what information the AI receives** and **how it is structured**.

Its primary responsibilities:
1.  **Context Resolution:** Collect potentially relevant information from multiple sources (files, symbols, git history, docs, previous decisions).
2.  **Context Ranking:** Score and prioritize information by relevance to the specific Task.
3.  **Context Compression:** Reduce token usage by summarizing, truncating, or filtering low-value information.
4.  **Context Delivery:** Package the final context and deliver it to the Agent Runtime before execution begins.

> **Core Principle:** Context should be selected by relevance, not simply dumped into the model. More context is not better — better context is better.

---

# 2. Core Domain Objects

## 2.1 ContextRequest

```text
ContextRequest
├── task_id: TaskID
├── task_description: string
├── requirements: string
├── project_id: ProjectID
├── repository: RepositoryRef
├── target_files: List[FilePath] (files mentioned in the task)
├── previous_context: ContextID (reference to previous context snapshot)
└── max_tokens: int (budget for context window)
```

## 2.2 ContextSnapshot

```text
ContextSnapshot
├── id: ContextID
├── task_id: TaskID
├── created_at: timestamp
├── sources: List[ContextSource]
│   ├── ContextSource
│   │   ├── type: "FILE" | "SYMBOL" | "GIT_HISTORY" | "DOCUMENTATION" | "ARCHITECTURE" | "TEST" | "DECISION" | "EVIDENCE"
│   │   ├── source_id: string
│   │   ├── relevance_score: float (0.0 - 1.0)
│   │   ├── content: string (the actual content)
│   │   ├── token_count: int
│   │   └── metadata: Map[string, any]
│   └── ...
├── total_tokens: int
├── rank_method: string (Phase 1 literal: `"phase1-keyword-dependency"`)
├── metadata: Map[string, any] (carries `tokenizer`, `targetFiles`, and `freshness_events` — see §8)
└── summary: string (optional compressed summary)
```

## 2.3 ContextPolicy

```text
ContextPolicy
├── max_sources: int (max number of sources to include)
├── max_tokens_per_source: int
├── min_relevance_threshold: float (0.0 - 1.0)
├── compression_strategy: "NONE" | "TRUNCATE" | "SUMMARIZE" | "HYBRID"
├── include_git_history: boolean
├── include_architecture: boolean
├── include_previous_decisions: boolean
└── include_runtime_evidence: boolean
```

---

# 3. Context Resolution Pipeline

```text
Task
 │
 ▼
┌──────────────────────────────────────────────────────┐
│                  1. SOURCE COLLECTION                 │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ File     │  │ Symbol   │  │ Architecture     │   │
│  │ Scanner  │  │ Resolver │  │ Analyzer         │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Git      │  │ Test     │  │ Previous Decision│   │
│  │ History  │  │ Finder   │  │ Retriever        │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
│                                                       │
│  ┌──────────┐  ┌──────────┐                          │
│  │ Documentation│Runtime  │                          │
│  │ Scanner  │  │ Evidence │                          │
│  └──────────┘  └──────────┘                          │
└───────────────────────────┬──────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────┐
│                  2. RELEVANCE RANKING                 │
│                                                       │
│  For each source:                                     │
│  - Semantic similarity to task description            │
│  - Keyword overlap                                    │
│  - Recency (git history)                              │
│  - Dependency graph proximity                         │
│  - Previous usage in similar tasks                    │
│                                                       │
│  Score: 0.0 (irrelevant) → 1.0 (highly relevant)     │
└───────────────────────────┬──────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────┐
│                  3. CONTEXT COMPRESSION               │
│                                                       │
│  - Remove sources below threshold                     │
│  - Truncate long files (keep relevant sections)       │
│  - Summarize documentation                            │
│  - Deduplicate overlapping content                    │
│  - Trim to fit max_tokens budget                      │
└───────────────────────────┬──────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────┐
│                  4. CONTEXT DELIVERY                  │
│                                                       │
│  Package into structured format:                      │
│  - Project context (architecture, rules)              │
│  - Task context (description, requirements)           │
│  - File context (relevant files with line numbers)    │
│  - Historical context (previous decisions, patterns)  │
│  - Evidence context (test results, runtime data)      │
└──────────────────────────────────────────────────────┘
                            │
                            ▼
                        Agent Runtime
```

---

# 4. Context Sources

## 4.1 File Scanner

Scans the repository for files relevant to the task.

**Strategy:**
- If task mentions specific files, prioritize those files
- Use code indexing to find files containing related symbols
- Use dependency graph to find files that import/are imported by target files
- Limit to files within the project's source directories

**Output:** List of file paths with metadata (size, language, last modified)

## 4.2 Symbol Resolver

Resolves symbols (classes, functions, types) referenced in the task.

**Strategy:**
- Parse task description for symbol names
- Use code index (or simple grep) to find definitions
- Include type signatures and public API surface
- Exclude implementation details of unrelated symbols

## 4.3 Architecture Analyzer

Provides the AI with project structure and architectural rules.

**Strategy:**
- Include project directory structure (top 2-3 levels)
- Include architecture decision records (ADRs) relevant to the task
- Include dependency diagrams (module-level)
- Include coding standards and conventions

## 4.4 Git History Retriever

Provides recent changes and context from version control.

**Strategy:**
- Include recent commits affecting target files
- Include diff summaries for recent changes (last N commits)
- Include branch information and merge history
- Exclude binary files and generated files

## 4.5 Previous Decision Retriever

Retrieves past human decisions that are relevant to the current task.

**Strategy:**
- Search Memory/Evidence system for decisions on similar tasks
- Include decision outcomes and reasons
- Include patterns that were approved or rejected

---

# 5. Context Ranking Algorithm

Each source receives a relevance score based on multiple signals:

```text
relevance_score = w1 * semantic_similarity
                + w2 * keyword_overlap
                + w3 * recency_factor
                + w4 * dependency_proximity
                + w5 * historical_usage
```

Where:
- `semantic_similarity`: Cosine similarity between source content and task description (using embeddings)
- `keyword_overlap`: Jaccard similarity of keywords between task and source
- `recency_factor`: Higher score for recently modified files (decay over time)
- `dependency_proximity`: Higher score for files that are directly imported/referenced by target files
- `historical_usage`: Higher score for files frequently used in similar tasks

**Weights:** Initially equal (0.2 each), can be tuned based on empirical results.

> **Phase 1 vs target formula (important):** In Phase 1–2 the system has **no embedding model and no historical usage data**. The Phase 1 scoring function is therefore:
>
> `relevance_score = 0.7 * keyword_overlap + 0.3 * dependency_proximity`
>
> (`dependency_proximity` itself is approximated by "same directory / imported by target file" heuristics until a code index exists.) `semantic_similarity`, `recency_factor`, and `historical_usage` are fixed at 0 and only enter the formula in Phase 3, when embeddings and the Memory system are available. Implementations must keep the formula pluggable so terms can be activated without changing callers.

## 5.1 Hybrid Retrieval & Re-ranking (Phase 3 seam)

The Phase-1 "keyword-only" ranker is deliberately simple, but the retrieval *pipeline*
is owned by a `Retriever` interface so the matching strategy can be swapped without
touching callers. The target shape — adopted from the reference skills framework — is a
**hybrid lexical + semantic** retriever with a fusion + re-rank stage:

```text
                    ┌──────────────────────────────┐
                    │           Query               │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   ┌──────────────────────┐                 ┌──────────────────────┐
   │  Lexical retriever    │                 │  Semantic retriever  │
   │  (keyword / BM25 over │                 │  (embeddings over     │
   │   code + doc index)   │                 │   code + doc shards)  │
   └──────────┬───────────┘                 └──────────┬───────────┘
              │                                        │
              └────────────────┬───────────────────────┘
                               ▼
                 ┌──────────────────────────────┐
                 │  Fusion — Reciprocal Rank    │
                 │  Fusion (RRF):               │
                 │  score(d) = Σ 1/(k + rank_i) │
                 └──────────────┬───────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │  Re-ranker (cross-encoder /  │
                 │  LLM-as-judge, Optional)     │
                 │  → final ordering + budget   │
                 └──────────────┬───────────────┘
                                ▼
                       ContextSnapshot
```

Rules that Phase 1 commits to now (and Phase 3 implements):

- **Single `Retriever` interface.** Phase 1 returns the keyword ranker as its one
  implementation; Phase 3 adds the hybrid implementation behind the same interface.
- **RRF as the default fusion.** Reciprocal Rank Fusion (`k` ≈ 60) is the only supported
  fusion in v1 because it needs no score normalization and no per-retriever tuning —
  each retriever contributes its rank, and fusion re-orders deterministically.
- **Re-rank as a bounded, audit-logged stage.** A cross-encoder or LLM-as-judge reranker
  only re-orders the top-N candidates returned by fusion (never the full index), and the
  re-ranked order is recorded into the `ContextSnapshot` metadata so the Evaluation
  Engine (Spec 11) can measure whether re-ranking actually changed agent/reviewer use of
  the context. Any re-rank must leave the target-file rule (§6) intact.
- **Index boundary:** Phase 3 introduces the code/document index and embeddings as a
  separate, replaceable infrastructure component. Phase 1 does not build it, but the
  `ContextSource.type` already distinguishes `FILE | SYMBOL | ARCHITECTURE | DOCUMENTATION`
  so the future index has a stable shard key. (Phase 2 may stand up the embeddings index
  + `Embedder` as **shadow/experimental infra** — measured by the A/B harness (Spec 11 §5),
  not used as default ranking — but hybrid does **not** become the default until Phase 3.)

## 5.2 Hierarchical Context, Validity & Caching (from the reference skills framework)

Beyond *which* items are selected, the reference framework also constrains *how* the
selected material is structured and kept non-stale. Three techniques map directly onto
this engine and are adopted as follows:

### 5.2.1 Five-level hierarchical context (Phase 1 layout, Phase 3 depth)

The delivery stage (§3, step 4) already groups context into project / task / file /
historical / evidence. The framework's 5-level model formalizes an **eviction order** so
budget trimming is deterministic rather than "truncate whatever is last":

```text
Level 0  Global / system  (architecture rules, project conventions, model instructions)  ~500 tok
Level 1  Task             (description, requirements, output schema)
Level 2  Code / archive   (ranked source files, symbols, git history)
Level 3  Decisions        (previous human decisions + reasons)
Level 4  Focused          (target files from the task, always full content)
```

- **Evict bottom-up:** when over budget, drop from the highest level (least focused)
  first — Level 4 target files are the last thing touched. This makes §6's priority rule
  ("never remove the target file") a structural guarantee, not a special case.
- **Never evict Level 0.** System/architecture context is cheap and load-bearing; losing
  it changes the agent's behavior in ways that are hard to attribute.

### 5.2.2 Lost-in-the-middle & why re-ranking matters

Models attend best to the beginning and end of a prompt; mid-prompt items are weakly
recalled ("lost in the middle"). This is the quantitative reason §5.1 forces a
**re-rank over top-N** instead of dumping the full ranked list: the highest-value items
must be placed at the head of the delivered context. It also argues for smaller, focused
contexts over "everything that might be relevant".

### 5.2.3 Context cache (Phase 2)

Phase 2's "context caching" bullet (§10) is refined here: cache resolved
`ContextSource` content keyed by `source_id + content_hash`.

- **Hit:** reuse parsed content, skipping file read + parse.
- **Invalidation:** the hash changes when the file changes — a stale entry is simply a
  cache miss, never a poisoned result. No TTL clock is required; the hash *is* the truth
  (§8's freshness rule).
- **Scope:** cache is per-source, read-only, and shared across tasks within a project.
  The `ContextSnapshot` itself is *not* cached — snapshots are point-in-time and must
  reflect the actual resolution a task consumed (for the trajectory/provenance record).

### 5.2.4 Context validation gate (Phase 2)

Before a `ContextSnapshot` is handed to the Agent Runtime, a lightweight validator checks
structural soundness (mirroring the framework's `ContextValidator`):

1. **Token budget:** `total_tokens ≤ max_tokens` (hard fail).
2. **Target-files present:** every `target_files` entry is included in full (hard fail —
   the snapshot is useless to the task otherwise).
3. **Freshness:** no `target_file` marked `STALE` without an explicit `stale_warning`
   attached for the consumer (§8).
4. **Relevance floor:** at least one source clears `min_relevance_threshold` (warn-only;
   an empty context is allowed only for tasks that declare no file input).

A failed gate re-resolves once; a second failure is an error surfaced to the Orchestrator,
never a silently degraded context.

### 5.2.5 RAG Fusion (multi-query, Phase 3)

Phase 3 may upgrade the semantic retriever to **RAG Fusion**: expand the task into *k*
query variants (paraphrases / symbol-focussed / history-focussed), run each against the
index, and fuse the result sets with the same RRF from §5.1. This raises recall for
indirectly-related files without any change to the `Retriever` interface. Multi-query is
**optional and behind the seam** — Phase 1's single-query keyword ranker remains the
default.

---

# 6. Context Compression Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **NONE** | Pass full content as-is | Small files, critical files |
| **TRUNCATE** | Keep first N tokens, add summary of truncated content | Large files where only the beginning is relevant |
| **SUMMARIZE** | Replace content with AI-generated summary | Documentation, long comments |
| **HYBRID** | Keep key sections full, summarize the rest | Mixed files with both critical and boilerplate content |

**Priority rules during compression:**
1. Never remove the target file specified in the task
2. Never remove architecture rules or project conventions
3. Prefer removing git history and documentation before source code
4. If still over budget, truncate lower-ranked files first

---

# 7. Interaction with Other Subsystems

```text
                    ┌──────────────────┐
                    │  Context Engine  │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
│  Task Orchestrator│  │ Agent Runtime│  │ Memory/Evidence│
│  (Receives context│  │ (Uses context│  │ (Stores context│
│   request)       │  │  for execution)│  │  snapshots)   │
└─────────────────┘  └──────────────┘  └──────────────┘
         │
         ▼
┌─────────────────┐
│  Code Index     │
│  (File/symbol   │
│   search)       │
└─────────────────┘
```

**With Task Orchestrator:** When a Task is created, the Orchestrator calls the Context Engine to prepare context before dispatching to the Agent Runtime.

**With Agent Runtime:** The Runtime receives the pre-packaged ContextSnapshot and uses it as the basis for its execution. The Runtime may request additional context during execution if needed.

**With Memory/Evidence:** Context snapshots are stored for later retrieval. Previous context snapshots can be used as input for similar tasks.

**With Code Index:** The Context Engine uses the code index (if available) for fast symbol resolution and file search. If no code index exists, falls back to file system operations.

---

# 8. Internal Architecture

```text
┌──────────────────────────────────────────────────────┐
│                  CONTEXT ENGINE MODULE                │
├──────────────────────────────────────────────────────┤
│                                                       │
│ 1. Context Request Handler                           │
│    - Validates incoming context requests              │
│    - Determines which sources to query               │
│    - Applies ContextPolicy                           │
│                                                       │
│ 2. Source Collectors                                  │
│    - FileCollector: Scans repository files           │
│    - SymbolCollector: Resolves symbols                │
│    - GitCollector: Retrieves git history              │
│    - DocCollector: Finds relevant documentation       │
│    - DecisionCollector: Queries memory system         │
│                                                       │
│ 3. Relevance Ranker                                  │
│    - Computes relevance scores for each source        │
│    - Filters sources below threshold                  │
│    - Sorts by relevance score (descending)            │
│                                                       │
│ 4. Context Compressor                                │
│    - Applies compression strategy per source          │
│    - Tracks token budget                              │
│    - Trims excess sources                             │
│                                                       │
│ 5. Context Packager                                  │
│    - Assembles final ContextSnapshot                  │
│    - Formats for the target Agent type               │
│    - Returns snapshot to caller                       │
└──────────────────────────────────────────────────────┘
```

> **Tokenizer strategy:** Token counting is model-dependent. The Engine counts tokens through a `Tokenizer` interface — since Day 19 an *exact* counter (`TiktokenTokenizer`, js-tiktoken byte-level BPE behind the seam), replacing the Phase-1 `chars/4` approximation. `max_tokens` budgets are always interpreted using the tokenizer of the target model configured in the request, never a global constant (`getTokenizer(model)` maps the model id to its encoding, falling back to `cl100k_base` for unknown models).

> **Freshness / invalidation:** A `ContextSnapshot` is a point-in-time view. Files may change between `resolveContext()` and agent execution (another task, a human edit). Each source records `content_hash` at collection time; before dispatch the Engine re-hashes `target_files` and marks the snapshot `STALE` if any changed. Consumers may still use a STALE snapshot (with a warning in the trajectory) or request re-resolution — the Orchestrator's policy decides (default: re-resolve target files only, keep the rest).
>
> **As-built `metadata` shape (Day 29, updated Day 19):** the snapshot `metadata` records `tokenizer: this.tokenizer.name` (e.g. `'tiktoken:cl100k_base'` for the default encoder — the exact counter, replacing the Phase-1 `'approx-4'` label) plus the request's `targetFiles`, `taskDescription`, and `requirements`. Each STALE re-resolve appends a `freshness_events` entry of the form `{ at: <ISO-8601>, stale: string[] }` (repo-relative paths of every source whose `content_hash` changed), so the freshness history becomes part of the provenance record itself.

---

# 9. API Surface

```typescript
interface IContextEngine {
  // Main entry point — resolve context for a task
  resolveContext(request: ContextRequest): Promise<ContextSnapshot>;

  // Get a previously stored context snapshot
  getContextSnapshot(contextId: ContextID): Promise<ContextSnapshot>;

  // Update the context policy for a project
  setContextPolicy(projectId: ProjectID, policy: ContextPolicy): Promise<void>;

  // Request additional context during agent execution
  requestAdditionalContext(
    taskId: TaskID,
    query: string,
    maxTokens: number
  ): Promise<ContextSource[]>;
}

interface ContextRequest {
  taskId: string;
  taskDescription: string;
  requirements: string;
  projectId: string;
  repository: { owner: string; name: string; branch: string };
  targetFiles?: string[];
  previousContextId?: string;
  maxTokens: number;
  policy?: ContextPolicy;
}

interface ContextSnapshot {
  id: string;
  taskId: string;
  createdAt: string;
  sources: ContextSource[];
  totalTokens: number;
  summary: string;
}

interface ContextSource {
  type: "FILE" | "SYMBOL" | "GIT_HISTORY" | "DOCUMENTATION"
       | "ARCHITECTURE" | "TEST" | "DECISION" | "EVIDENCE";
  sourceId: string;
  relevanceScore: number;
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
}
```

---

# 10. Phase 1 Implementation Plan

**Phase 1: "Basic File Scanner"**
- Implement the FileCollector only (list files relevant to the task by keyword matching)
- No ranking (all files are included)
- No compression (truncate by token limit only)
- Simple ContextPackager that returns raw file contents
- **Goal:** Prove that the pipeline works end-to-end

**Phase 2: "Symbol Resolution"**
- Add SymbolCollector using simple regex-based parsing
- Add basic relevance ranking (keyword overlap only)
- Add context caching to avoid re-scanning unchanged files
- Add `requestAdditionalContext` API so a running Agent can ask for more context mid-execution (budget-capped, logged into the trajectory)

**Phase 3: "Full Context Engine"**
- Add all source collectors
- Implement semantic similarity ranking (using embeddings)
- Implement hybrid retrieval: lexical + semantic + RRF fusion behind the `Retriever` interface (§5.1)
- Optional re-ranker (cross-encoder / LLM-as-judge) over the fusion top-N, audit-logged for Evaluation (Spec 11)
- Implement compression strategies (truncate, summarize)
- Add Git history and previous decision retrieval

---

# 11. Success Criteria

The Context Engine is Phase 1 complete when:

- Given a task "Fix bug in PaymentService.ts", the engine returns the content of PaymentService.ts and related files
- The engine respects the `max_tokens` budget and does not exceed it
- The engine correctly filters out binary files and node_modules
- The engine can resolve a task with no explicit file references (e.g., "Add logging to all API endpoints") by scanning relevant files

---

# 12. Concrete Next Steps

- [ ] Step 1: Define TypeScript interfaces for ContextRequest, ContextSnapshot, ContextSource
- [ ] Step 2: Implement FileCollector that scans repository files matching keywords
- [ ] Step 3: Implement basic ContextPackager that returns file contents as a string
- [ ] Step 4: Write unit tests for file scanning and token budgeting
- [ ] Step 5: Integrate with Task Orchestrator (call ContextEngine.resolveContext before Agent execution)

---

## Changelog

### v0.3 (Day 28)
- (Day 18): §5.1 — semantic retriever is shadow-only; the keyword→dependency path stays the default.
- (Day 19): §8 — exact tiktoken tokenizer replaces the `chars/4` approximation.
- (Day 20): §5.2.3 — context cache (freshness invalidation, zero-read safety).
### v0.2
- §2.2 — pinned `rank_method` to the shipped literal `"phase1-keyword-dependency"`
  (removing the v0.1 ambiguity of a free-form string).
- §8 — documented the persisted `metadata` shape: `tokenizer: 'approx-4'`,
  `targetFiles`/`taskDescription`/`requirements`, and the `freshness_events`
  array (`{ at, stale }` appended per STALE re-resolve).
- Confirmed the Phase-1 keyword→dependency ranker ({@link §5}) is unchanged; the
  hybrid/embeddings path remains a Phase 3 seam behind the `Retriever` interface.
- No code divergences found.

### v0.2 (Day 19 — exact tokenizer)
- §8 — replaced the Phase-1 `chars/4` (`ApproxTokenizer`) with an exact
  `TiktokenTokenizer` (js-tiktoken, statically linked local ranks — no runtime
  network fetch). The `Tokenizer` seam now also declares `truncate(text, maxTokens)`
  (encode → slice → decode, never a naive `substring` that could split a surrogate
  pair) and a `readonly name` stamped onto the snapshot.
- §8 — added `getTokenizer(model)` for per-model resolution (encodings differ by
  family: `cl100k_base` vs `o200k_base`), falling back to `cl100k_base` for
  unknown ids; the engine's default tokenizer is `cl100k_base`, and `metadata.tokenizer`
  is now the tokenizer's own `name` (`tiktoken:cl100k_base`) instead of `'approx-4'`.
- §5 — the budget trimmer now truncates via `tokenizer.truncate` (exact), with
  the priority rules unchanged; a regression test asserts that a 100-space file
  (chars/4 count 25, exact count 2) is now kept in full where `chars/4` would have
  truncated it.