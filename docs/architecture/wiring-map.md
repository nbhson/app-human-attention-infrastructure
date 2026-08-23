# Wiring Map

> **Living document.** Every time an engine is registered in `apps/api/src/bootstrap.ts`, add a row here. It takes ~2 minutes and saves hours of archaeology later.

This table records the object graph built by `buildContainer()` (`apps/api/src/bootstrap.ts`) — the **only** place `new InProcessEventBus()` may appear (day-05 §6). Everything else asks the container for a token via `resolve(TOKENS.*)`.

## Legend

- **Token** — string key from `packages/di/src/tokens.ts`.
- **Concrete class / factory** — what the token resolves to.
- **Registered on** — day the registration (or its stub) first appeared.
- **Resolved by** — who pulls this token out of the container.

## Current graph (`review-reorient` — code-gen retired)

Ordered as `buildContainer()` registers them, i.e. topologically.

| Token | Concrete class / factory | Registered on | Resolved by |
|---|---|---|---|
| `Logger` | `createRootLogger()` (pino) | Day 27 | `EventBus` (error handler), `EventLogWriter`, every subscriber, `AttentionRouter`, `AutoApproveExecutor`, `EmbeddingIndexer`, `CacheInvalidationListener`, `VerificationEngine` (sandboxed check), `ReviewService`, `ReviewIngestService` |
| `EventBus` | `InProcessEventBus(handler)` | Day 05 | `EventLogWriter`, every subscriber, `AttentionRouter`, `AutoApproveSampler`, `AutoApproveExecutor`, `TaskService`, `VerificationEngine`, `ReviewService`, `ReviewIngestService` |
| `Db` | `createDb(process.env.DATABASE_URL)` | Day 05 | everything that persists — `EventLogWriter`, `ArtifactTracker`, `ChangeStatusSubscriber`, `AttentionSubscriber`, `AttentionRouter`, the auto-approve chain, `EmbeddingIndexer`, `ReembedListener`, `SemanticRetriever`/`SemanticRanker`, `ContextEngine`, `ContextCache`, `CacheInvalidationListener`, `VerificationEngine`, `LoggingLLMProvider`, `TaskService`, `ReviewService` (+ inline `DiffEngine`), `ReviewIngestService` |
| `EventLogWriter` | `EventLogWriter(db, logger)` + `subscribeTo(EventBus)` | Day 05 | eager-resolved at boot (side effect: forwards bus events into `event_log`) |
| `OidcProvider` | `MockOidcProvider \| OpenIdClientProvider` (env-driven; `OIDC_MOCK`) | Day 30 | `AuthService` (browser login/callback exchange) |
| `SessionService` | `SessionService(db, ttlMs)` | Day 30 | `AuthService` (create/revoke/touch sessions) |
| `AuthService` | `AuthService(db, SessionService, {jwtSecret})` | Day 30 | `routes/auth.ts`, `apps/api/src/auth.ts` (hook decodes JWT + session) |
| `ContentStore` | `ObjectStoreContentStore(AwsS3ClientPort(...))` when `OBJECT_STORE_ENDPOINT` is set, else `InMemoryContentStore('object')` (ephemeral dev fallback) | Day 21 | `SnapshotStore` (large-content offload), `AttentionSubscriber`, `ReviewService` (`DiffEngine` read-back) |
| `SnapshotStore` | `SnapshotStore(ContentStore, threshold)` (content-addressed dedup; `content` stays inline at/under the threshold, offloads above it — `content_backend` `'db'`/`'object'`) | Day 14 (seam: Day 21) | `ArtifactTracker` |
| `ArtifactTracker` | `ArtifactTracker(db, SnapshotStore)` | Day 14 | `ArtifactCaptureSubscriber` |
| `ArtifactCaptureSubscriber` | `ArtifactCaptureSubscriber(ArtifactTracker, logger)` + `subscribe(EventBus)` | Day 14 | eager-resolved at boot (side effect: `artifact.created` → tracker capture) |
| `ChangeStatusSubscriber` | `ChangeStatusSubscriber(db, logger)` + `subscribe(EventBus)` | Day 14 | eager-resolved at boot (side effect: **sole writer** of `changes.status` — `PENDING→VERIFIED→REVIEWED`, any→`ROLLED_BACK`) |
| `WeightsProvider` | `StaticWeightsAdapter()` (returns the Phase-1 placeholder) | Day 12 | `AttentionSubscriber` (threads the active vector into `computePriority`; **not flipped** — the Day-12/15 fit did not beat the placeholder) |
| `AttentionSubscriber` | `AttentionSubscriber(db, logger, WeightsProvider, ContentStore)` + `subscribe(EventBus)` | Day 18 (WeightsProvider seam: Day 12) | eager-resolved at boot (side effect: `task.state_changed`→`AWAITING_REVIEW` scores the five factors → `assessments` row → `attention.assessment_created`) |
| `AttentionRouter` | `AttentionRouter(db, EventBus, ATTENTION_POLICY_V1, logger)` + `subscribe()` | Day 19 | eager-resolved at boot (side effect: `attention.assessment_created` → policy match + fatigue controls → `review_queue` → `attention.item_routed`); `ReviewService` (feedback seam) |
| `AutoApproveGate` | `AutoApproveGate({ maxRisk, inflationCeiling })` (pure evaluator, no deps) | Day 14 | `AutoApproveExecutor` (the three-part gate — calibration green ∧ flag on ∧ under the bar) |
| `AutoApproveKillSwitch` | `AutoApproveKillSwitch(db)` (single-row `auto_approve_kill_switch`) | Day 14 | `AutoApproveExecutor` (reads flag/kill on every decision); `routes/admin.ts` (flag flip / kill) |
| `AutoApproveSampler` | `AutoApproveSampler(db, EventBus, logger)` + `subscribe()` | Day 14 | eager-resolved at boot (side effect: `decision.submitted` REJECTED on a sampled control → `attention.escalation_leakage`) |
| `AutoApproveExecutor` | `AutoApproveExecutor(db, EventBus, gate, killSwitch, sampler, taskTransition, policy, DbAutoApproveLoader(db), logger)` + `subscribe()` | Day 14 | eager-resolved at boot (side effect: `attention.item_routed` `AUTO_APPROVABLE` → gate → `AUTO_APPROVED` decision, `actor_id IS NULL`, task `AWAITING_REVIEW→APPROVED` under `triggered_by 'auto_approve'`) |
| `Embedder` | `StubEmbedder()` (default) \| `OpenAICompatibleEmbedder({baseUrl, apiKey, model})` when `EMBEDDINGS_BASE_URL` is set | Day 16 | `EmbeddingIndexer`, `SemanticRetriever`, `SemanticRanker`, `ContextEngine`; the keyword path never reads it |
| `EmbeddingIndexer` | `EmbeddingIndexer(db, Embedder, {}, Logger)` | Day 17 | `ReembedListener`; out-of-band `pnpm embed:populate` CLI |
| `ReembedListener` | `ReembedListener(db, EmbeddingIndexer, Logger)` + `subscribe(EventBus)` | Day 17 | eager-resolved at boot (side effect: `artifact.created`/`artifact.changed` → re-embed the FILE source keyed on `content_hash`) |
| `SemanticRetriever` | `SemanticRetriever(db, Embedder)` | Day 18 | cosine similarity over the populated index; **not** on the default resolve path (only reachable via `resolveWithShadow`) |
| `SemanticRanker` | `SemanticRanker(db, Embedder, SemanticRetriever)` | Day 18 | wraps the retriever with the freshness guard + target-file rule; **not** on the default resolve path |
| `ContextCache` | `PostgresContextCache(db)` | Day 20 | read-optimization leaf for the collector; `get(sourceId, contentHash)` is the truth, `getByStat(sourceId, mtime, size)` is the zero-read fast-path |
| `CacheInvalidationListener` | `CacheInvalidationListener(db, ContextCache, Logger)` + `subscribe(EventBus)` | Day 20 | registered (subscribes on resolution): `artifact.created`/`artifact.changed` → `invalidate`. Note — not in `bootContainer`'s eager list today, so its subscription binds only if something else resolves it |
| `ContextEngine` | `ContextEngine(db, FileCollector(sandboxRoot, ContextCache), KeywordDependencyRanker(), TiktokenTokenizer(), Embedder, SemanticRanker)` | Day 20 | eager-resolved at boot. Retained for Phase-3 review-context assembly (the retired `COLLECT_CONTEXT` step handler no longer resolves it) |
| `EvidenceStore` | `EvidenceStore()` | Day 17 | `VerificationEngine` |
| `Sandbox` | `DockerSandbox()` | Day 22 | `VerificationEngine` (only when `VERIFY_SANDBOX_ENABLED=1`) |
| `VerificationEngine` | `VerificationEngine(db, EventBus, {CompileCheck, TestCheck}, EvidenceStore)` (+ `SandboxedCheck` when enabled) | Day 15/16/17/22 | retained for Phase-3 clone-and-test; the retired `VERIFY` step handler no longer resolves it |
| `LLMProvider` | `LoggingLLMProvider(AnthropicProvider(key) \| OpenAICompatibleProvider \| MockLLM(script), db)` | Day 11 | `ReviewAgent` |
| `TaskStateMachine` | `TaskStateMachine` (pure transition table, no deps) | Day 06 | `TaskService` |
| `TaskService` | `TaskService(db, EventBus, TaskStateMachine)` | Day 06 | `ReviewService` (transition seam), `AutoApproveExecutor` (transition seam), `ReviewIngestService` (createTask + immediate CANCELLED anchor) |
| `GitProvider` | `GitHubProvider(token, baseUrl)` when `GITHUB_TOKEN` set, else `null` | review-reorient | `ReviewIngestService` (fetch the PR diff/metadata) |
| `TicketProvider` | `JiraProvider(token, baseUrl)` when `JIRA_TOKEN`/`JIRA_BASE_URL` set, else `null` | review-reorient | `ReviewIngestService` (fetch the requirement) |
| `McpServerRegistry` | `McpServerRegistryImpl(loadMcpConfig(path, env))` | review-reorient (day-02) | `routes/settings.ts` (list configured servers), `WriteBackService` (lazy client per provider) |
| `WriteBackService` | `MCPWriteBack(McpServerRegistry, StaticGitToolMap, StaticTicketToolMap, DrizzleWritebackLogStore(Db))` | review-reorient (day-06, audit day-08, toggle day-09) | `routes/reviews.ts` (`POST /api/reviews/:id/decision` — the `writebackEnabled` gate decides whether a COMMENT + STATUS / COMMENT + TRANSITION is emitted to the external host) |
| `ReviewAgent` | `ReviewAgent(LLMProvider)` | review-reorient | `ReviewIngestService` (LLM → structured report + findings + fix suggestions) |
| `ReviewIngestService` | `ReviewIngestService(db, bus, taskService, gitProvider, ticketProvider, reviewAgent, aiProvider, model, logger)` | review-reorient | `routes/reviews.ts` (`POST /api/reviews`, `GET /api/reviews/:id`) |
| `MemoryStore` | `MemoryStore(Db, EventBus, Logger)` | review-reorient (day-16) | `MemoryProvider` (the `MemoryRetriever` read path); the `MemoryIngestor` write path is wired by `demo:memory` + unit tests, not yet bound at server boot (see the note below). Sole writer of `memory_entries` — every entry carries ≥1 `memory_entry_evidence` link. |
| `MemoryProvider` | `MemoryRetriever(MemoryStore, () => new Date(), Logger)` | review-reorient (day-18) | `MemoryContextResolver` via the domain `MemoryProvider` seam (so `@harness/context-engine` reads memory without importing `@harness/memory`) |
| `MemoryContextResolver` | `MemoryContextResolver(MemoryProvider)` | review-reorient (day-18) | pulls top-K memory and injects it as a `memory` section on a `ContextSnapshot` (`metadata.memory`); not resolved by any route today |
| `MemoryLifecycle` | `MemoryLifecycle(Db, EventBus, Logger)` | review-reorient (day-19) | not eagerly started — a server entrypoint drives `tick()` (consolidate → decay → archive), directly or via `MemoryLifecycleScheduler` |
| `ReviewService` | `ReviewService(db, EventBus, {transitionTask, reportAssessmentFeedback, diffChange}, logger)` | Day 22 | `routes/review.ts` (claim/decide/drop + release/escalate); `DiffEngine` is constructed inline to back `diffChange` |
| `MetricsComputer` | `MetricsComputer()` (stateless, pure — offline) | Day 06 | Day 07 report generator (`EVAL_REPORT_SCHEDULE` cron); the `pnpm eval:metrics` CLI constructs it directly (out-of-band) today |
| `Orchestrator` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (no longer developed; the dispatch/workflow/retry loop was retired) |
| `AgentRuntime` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (the code-gen runner was retired; the review work landed under `ReviewAgent` + `ReviewIngestService`) |
| `AttentionEngine` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (the real work landed in `AttentionSubscriber` + `AttentionRouter`) |

The write-back subsystem persists to two tables: `writeback_log` (the append-only
audit of every external write attempt — `PENDING`→`SUCCEEDED`/`FAILED`/`DUPLICATE`,
with a unique partial index on `dedup_key WHERE status='SUCCEEDED'` enforcing one
external write per decision, day-08) and `review_decisions` (the human verdict,
linked back from `writeback_log.decision_id`, day-09). `WriteBackService` is
resolved lazily by the decision route — it is **not** in `bootContainer()`'s eager
list, so a review decision is the only thing that ever reaches an external MCP tool.

The review-memory subsystem (day-16/17/18/19) is registered lazily — none of its
four tokens is in `bootContainer()`'s eager list. The **read** half (`MemoryProvider`
→ `MemoryContextResolver`) is fully wired for the container: any future consumer
resolves `TOKENS.MemoryContextResolver` and injects top-K memory into a snapshot.
The **write** half (`MemoryIngestor` → `MemoryDistiller` → `MemoryStore`) is *not*
bound at server boot today — its two `subscribe()` registrations (on
`review.report_created` / `review.decision_submitted`) are exercised by
`scripts/demo-memory.ts` (`pnpm demo:memory`) and the `@harness/memory` unit suite,
which construct `new MemoryIngestor(db, bus, store).subscribe()` directly. Binding
that subscription into `bootContainer()` is a later integration step, not a gap in
the memory domain itself — the `memory.entry_created` event is already emitted so
the bus can fan in the moment the ingestor is subscribed.

The three `ENGINE_STUB_TOKENS` (`Orchestrator`, `AgentRuntime`, `AttentionEngine`) are the
Day-05 placeholder names. `Orchestrator` and `AgentRuntime`'s code-generation concretions
(`Dispatcher`/`DispatchLoop`/`WorkflowRunner`, `AgentRunner`/`RuntimePollLoop`/`ToolRegistry`)
were **retired** in `review-reorient`, so those two stubs now simply mark the abandoned
names. `AttentionEngine`'s live integration points remain `AttentionSubscriber` +
`AttentionRouter`. `bootContainer()` (below) deliberately resolves only the subscriber/service tokens.

### Verification breadth (Phase 3) — seams, not DI tokens

The clone → sandbox → targeted-verify path (days 11–15) is assembled at the **app
host**, not in `buildContainer()`. Several seams carry it, and none registers a DI
token — they are structural, bound where the app is allowed to import both a graph
leaf and an engine (rule R5 / R4):

| Seam | Package (day) | Role | How the app binds it |
|---|---|---|---|
| `cloneAndCheckout` | `git-provider/src/clone.ts` (day-11) | Shallow clone + fetch head SHA + detach-checkout-at-SHA; injectable `RunGit`; throws `CloneError` on any non-zero git exit (never a silently-empty worktree) | `CloneResult` is structurally identical to the engine's `CloneWorktree`, so the host maps provider output → engine input without the engine importing `git-provider` (rule R4). The engine never names a Git host. |
| `CloneVerifier` | `verification-engine/src/clone-verifier.ts` (day-12) | COMPILE → TEST, **fail-closed**: a non-passing COMPILE short-circuits TEST to `SKIPPED` | Consumes a `CloneWorktree` (above); runs the clone's own `build`/`test` scripts in the Docker sandbox via `computeWorkdirManifest` + `SandboxRunner`. |
| `code-index` | `code-index/src/{indexer,graph,affected}.ts` (day-14) | Pure leaf (node built-ins only): `indexFiles` → `buildGraph` → `affectedTests` computes the transitive affected-test closure; `complete:false` on a graph gap | Consumed by the app host only — **never** imported by `verification-engine` (rule R4). |
| `TargetedVerifier` | `verification-engine/src/targeted-verifier.ts` (day-14) | The *routing policy*: affected set when complete and non-empty, else full suite | The app injects `resolveAffected = (changed) => affectedTests(changed, graph)` — the engine owns the policy, the leaf owns the graph; neither imports the other. |

`scripts/demo-verification.ts` (`pnpm demo:verification`, day-15) is the
integration point that binds these four together over a recorded fixture: it
proves targeted verdict == full verdict on every case (green *and* red) with fewer
tests, falls back to the full suite on any graph gap / unindexed file / empty
affected set, and shows a FAILED clone surfaces as a `CloneError`, teardown runs on
failure, and the day-13 `flagReport`/`renderFlag` output annotates (never gates)
the review. The actual sandbox execution legs are unit-covered by `clone-verifier`
+ `sandboxed-check` parity, so the demo runs credential-free (no Docker, no network).

### Retrieval seam (Phase 3) — the held `rank_method` default

The Day-26/27/28 retrieval surface (`Retriever` / `RetrievedDoc` / `RetrieverFactory`)
is also a **seam, not a DI token**, and it is **build-only**: `RetrieverFactory.resolve
(rank_method)` returns the keyword / `hybrid` / `rag_fusion` retriever, but the engine's
hot path — `ContextEngine.resolveContext` above — still calls `KeywordDependencyRanker()`
directly (`rank_method = 'phase1-keyword-dependency'`, `trim.ts`). So the factory is an
available, exercised cutover point, not yet the engine's ranking source.

The default is **held at `keyword`** by the Day-29 A/B gate (see
`docs/retros/phase3-w6-cutover.md`). `DEFAULT_RANK_METHOD = RANK_METHOD_KEYWORD`: over the
three-fixture replay corpus the hybrid arm reproduced the keyword order exactly
(`rank_correlation` tau = 1.0, 0% disagreement), so the evidence was **insufficient** and
the harness answered `keep-shadow` — the default does not flip on a non-result, only on a
measured WIN (rework down, context acceptance ≥). `hybrid` and `rag_fusion` both remain
*selectable* per request via an explicit `rank_method`, and flipping the default is a
one-line change to `retriever-factory.ts` with the A/B report as its audit trail. The
round-trip — default → `'hybrid'` → kill-switch `'keyword'` → default — is proven by
`scripts/demo-hybrid-default.ts` (`pnpm demo:hybrid-default`, day-30), which runs the
real `LexicalRetriever` + `HybridRetriever` (RRF) hermetically: only the embedder's
cosine ranking is stubbed.

### Learning loop (Phase 3, day-31) — Evaluate → Calibrate → (measured) Deploy

`CalibrationJob` (in `@harness/attention-engine/src/learning/`) is a **structural
seam, not a DI token**, and it is **not** eagerly started: like `MemoryLifecycle`,
a server entrypoint (or the `demo:learning-loop` script) drives `run(since)` on a
cadence. It composes three injected pieces — a `CollectSeam` (reads new
`was_useful` + judge + factor facts from the DB), a `FitSeam` (the app binds
evaluation's `fitJudgeWeights` across the boundary, since `attention-engine` may
not import `evaluation` — R4), and `decidePromotion` (the measured PROMOTE/HOLD
guardrail). Automation stops at the gate: a candidate that does not **win** its
held-out ranking comparison against the incumbent — or that trips the
`judgeSignalDominates` overfit alarm — is `HOLD`, and the job never applies a
weight vector itself (day-31 §2.2). The `WeightsProvider` on the routing hot path
is unchanged: `StaticWeightsAdapter` still returns the placeholder until a
promotion is explicitly adopted. See `scripts/demo-learning-loop.ts`.

### Usage feedback (Phase 3, day-32) — usefulness → learned ranking signal

Day 32 replaces the re-ranker's raw-popularity `usage` term (day-27 §2.4, "how
*often* surfaced") with a **learned** signal ("did surfacing it *help*?").
`UsageLearner` (in `@harness/context-engine/src/ranking/`) is a **pure module**, not
a service: it takes `SourceUsefulness` observations (a `source_usefulness` row — new
table in `@harness/db`, keyed on `context_id` → `contexts.id`) and returns a
per-source `[minSignal, maxSignal]` map starting from neutral 0.5. Three invariants
keep it a signal, never a certainty: a **per-mark cap** (`maxSingleMark` = 0.2), a
**half-life decay**, and hard **bounds** (0.05/0.95). `ReRanker.reRank` gains an
optional `learnedUsage?` slot on `ReRankInput`; when present it **supersedes**
`retrievalCount`, and an unobserved source falls to the neutral 0.5 rather than 0 —
the same missing-signal fallback as day-27. There is no eager job here: the caller
(an app entrypoint) runs `learn()` over recent marks and passes the resulting map
into the re-rank. See `scripts/demo-usage-feedback.ts`.

### Tracing bootstrap (not a DI token)

Day-03's OpenTelemetry provider is deliberately **not** container-injected: the
tracer/metric provider is a module-global singleton owned by
`@harness/observability` (`initTracing` / `getTracer` / `getMeter`), so there are
no `TOKENS.Tracer` / `TOKENS.Meter` entries. `apps/api/src/index.ts` calls
`initApiTracing(container)` as its **first** line (after `buildContainer`) so a
provider exists before the first request; it reads only `Db` to wire the
`trace_correlation` write-through. `buildApp` then registers the `http.request`
span hook (`apps/api/src/trace.ts`, `registerTraceHook`) ahead of the auth hook,
so identity + handler work sit under one per-request root span. Engines get
spans by importing `@harness/observability` directly — no token indirection.

Day 04 adds Prometheus metrics on a prom-client register (`@harness/observability`'s
`metrics.ts`, scraped by `apps/api`'s `GET /metrics`). Recorders fire at the
event seams — `AttentionRouter.route` (`harness_routing_items_total`, route
human|auto_approvable) and `ReviewService.decide` (`harness_review_dwell_seconds`,
`harness_assessment_usefulness_total`). Offline gauges (precision/recall/leakage/
inflation/false-pass) are *set* by `@harness/evaluation` on Day 06, never
incremented on the hot path.

Day 25 adds the continuous **Week-5 infra counters** and their recorder sites:
`SandboxedCheck.run` (`verification-engine`) records `harness_sandbox_run_total` +
`harness_sandbox_duration_seconds` on every container completion and
`harness_sandbox_fallback_total` on every `SandboxInfraError` before the
in-process parity fallback; `DiffEngine.contentFor` (`artifact-tracker`, which
now depends on `@harness/observability`) records
`harness_object_store_integrity_error_total` on a `ContentIntegrityError` before
rethrow. The cache hit/miss pair (Day 20) and these new counters **double-write a
plain in-process accumulator** (`snapshotInfraCounters`), because the report
generator wants a plain-number snapshot, not prom-client aggregation types.

### Offline evaluation (`MetricsComputer`) — registered but never on the hot path

Day 06 adds `TOKENS.MetricsComputer` to `packages/di/src/tokens.ts` and registers
it in `buildContainer()` as a plain `new MetricsComputer()` (it is stateless and
pure — no `Date.now()`, no env, no DB in `compute()` — so it takes no deps). It is
**not** resolved by `bootContainer()` and never runs on a request path: the
standalone `pnpm eval:metrics --from --to` CLI (`packages/evaluation/src/cli.ts`)
constructs it directly from a `loadMetricsInput(db, window)` read over the
append-only store. That is what keeps a window's numbers byte-identical in CI and
the A/B harness (Day 09). The token exists so Day 07's in-process report generator
(`EVAL_REPORT_SCHEDULE` cron inside `apps/api`) can resolve the same computer and
push the computed window onto the scraped register on a schedule; today the CLI's
`applyGauges` writes to *its own* process's register, which nobody scrapes — the
CLI's artifact is the printed JSON, not the gauge.

## Eager resolution (`bootContainer`)

Registrations are lazy, but bus subscriptions are **side effects** — so
`bootContainer(c)` (called by `index.ts`) resolves every token whose constructor
(or `subscribe()`) must bind to the bus before any task runs:

```text
EventLogWriter   ArtifactCaptureSubscriber   ChangeStatusSubscriber
AttentionSubscriber   AttentionRouter   AutoApproveSampler   AutoApproveExecutor
ContextEngine   ReembedListener   ReviewService
```

The review slice (`ReviewIngestService` / `ReviewAgent` / `GitProvider` /
`TicketProvider`) is resolved lazily by `routes/reviews.ts` on the first
`POST /api/reviews` — no side effect at boot.

## Bootstrap order (topological)

1. `Logger` — no deps.
2. `EventBus` — needs `Logger` (error handler).
3. `Db` — needs `DATABASE_URL`.
4. `EventLogWriter` — needs `Db`, `Logger`, `EventBus`.
5. `OidcProvider` — needs `OIDC_MOCK` to pick mock vs real; the real adapter needs `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
6. `SessionService` — needs `Db`, plus `SESSION_TTL_MS`.
7. `AuthService` — needs `Db`, `SessionService`, `JWT_SECRET`.
8. `ContentStore` — needs `OBJECT_STORE_ENDPOINT` (plus bucket/creds) for a real S3/MinIO backend, else an ephemeral `InMemoryContentStore` fallback with offload disabled. `SnapshotStore` — needs `ContentStore` and the offload threshold (`OBJECT_STORE_THRESHOLD_BYTES`, default 1 MiB).
9. `ArtifactTracker` — needs `Db`, `SnapshotStore`.
10. `ArtifactCaptureSubscriber` — needs `ArtifactTracker`, `Logger`, `EventBus`.
11. `ChangeStatusSubscriber` — needs `Db`, `Logger`, `EventBus`.
12. `WeightsProvider` — no deps (returns the Phase-1 placeholder via `StaticWeightsAdapter`).
13. `AttentionSubscriber` — needs `Db`, `Logger`, `WeightsProvider`, `ContentStore`, `EventBus`.
14. `AttentionRouter` — needs `Db`, `EventBus`, `ATTENTION_POLICY_V1`, `Logger`.
15. `AutoApproveGate` — needs `ATTENTION_POLICY_V1` (static tuning; pure evaluator, no container deps).
16. `AutoApproveKillSwitch` — needs `Db`.
17. `AutoApproveSampler` — needs `Db`, `EventBus`, `Logger`.
18. `AutoApproveExecutor` — needs `Db`, `EventBus`, `AutoApproveGate`, `AutoApproveKillSwitch`, `AutoApproveSampler`, `ATTENTION_POLICY_V1`, `DbAutoApproveLoader(Db)`, and the `taskTransition` seam onto `TaskService` (lazy-resolved).
19. `Embedder` — no deps (`StubEmbedder` default; `OpenAICompatibleEmbedder` when `EMBEDDINGS_BASE_URL` is set).
20. `EmbeddingIndexer` — needs `Db`, `Embedder`, `Logger`.
21. `ReembedListener` — needs `Db`, `EmbeddingIndexer`, `Logger`, `EventBus`.
22. `SemanticRetriever` — needs `Db`, `Embedder`.
23. `SemanticRanker` — needs `Db`, `Embedder`, `SemanticRetriever`.
24. `ContextCache` — needs `Db` (Postgres-backed `context_source_cache`).
25. `CacheInvalidationListener` — needs `Db`, `ContextCache`, `Logger`, `EventBus`.
26. `ContextEngine` — needs `Db`, `FileCollector(sandboxRoot, ContextCache)`, `KeywordDependencyRanker()`, `TiktokenTokenizer()`, `Embedder`, `SemanticRanker`.
27. `EvidenceStore` — no deps.
28. `Sandbox` — no deps (`DockerSandbox`).
29. `VerificationEngine` — needs `Db`, `EventBus`, `{CompileCheck, TestCheck}`, `EvidenceStore` (and `Sandbox` when enabled).
30. `LLMProvider` — needs `Db`, plus `ANTHROPIC_API_KEY` or `AI_BASE_URL` to pick the real adapter (else `MockLLM`).
31. `TaskStateMachine` — no deps.
32. `TaskService` — needs `Db`, `EventBus`, `TaskStateMachine`.
33. `GitProvider` — `GITHUB_TOKEN` (else `null`).
34. `TicketProvider` — `JIRA_BASE_URL` + `JIRA_TOKEN` (else `null`).
35. `McpServerRegistry` — needs `MCP_CONFIG_PATH` (default `./mcp.config.json`); parsed once at startup (day-02).
36. `WriteBackService` — needs `McpServerRegistry`, `Db`, the git/ticket tool maps (day-06).
37. `ReviewAgent` — needs `LLMProvider`.
38. `ReviewIngestService` — needs `Db`, `EventBus`, `TaskService`, `GitProvider`, `TicketProvider`, `ReviewAgent`, `aiProvider`, `model`, `Logger`.
39. `MemoryStore` — needs `Db`, `EventBus`, `Logger` (sole writer of `memory_entries`).
40. `MemoryProvider` — needs `MemoryStore`, a clock, `Logger` (resolves to `MemoryRetriever`).
41. `MemoryContextResolver` — needs `MemoryProvider`.
42. `MemoryLifecycle` — needs `Db`, `EventBus`, `Logger` (registered, not started).
43. `ReviewService` — needs `Db`, `EventBus`, three structural seams, `Logger`.
44. `MetricsComputer` — no deps.
45. `Orchestrator` / `AgentRuntime` / `AttentionEngine` — stubs (see above).

Engines receive `IEventBus` (the interface), never `InProcessEventBus` (the concrete class) — enforced by the container's type signatures.

## Dependency rules enforced

| Rule | Constraint | Enforced by |
|---|---|---|
| R1 | `domain` imports nothing | `eslint-plugin-boundaries` + architecture test |
| R2 | `event-bus` → `domain` only | same |
| R3 | `db` → `domain`, `event-bus` only | same |
| R4 | engines → `domain`, `event-bus`, `db`, `di` only | same |
| R5 | `apps/*` → any package | same |
| R6 | `review` → `domain`, `event-bus`, `db`, `di` only | same |
| R7 | `auth` → `domain`, `db`, `event-bus`, `di` only (never a sibling engine) | same (day-02) |
| R8 | `observability` → `domain`, `db`, `di` only; every telemetry-carrying engine depends on it | same (day-03) |
| R9 | `evaluation` → `domain`, `db`, `di`, `observability` only (never an engine) | same (day-06) |
| R10 | `embeddings` → `domain`, `db`, `event-bus` only (never `di`, `observability`, or an engine) | same (day-16 §2.4, widened day-17) |
| R11 | `object-store` → no `@harness/*` dependency (pure content-addressed leaf seam) | same (day-21 §2.1) |
| R12 | `sandbox` → no `@harness/*` dependency (pure leaf seam) | same (day-22 §2.1) |
| R13 | `git-provider` → `domain` only (never an engine) | same |
| R14 | `ticket-provider` → `domain` only (never an engine) | same |

The authoritative assertions live in `packages/di/src/__tests__/architecture.test.ts`; the lint rule catches violations at edit time (see `eslint.config.mjs`).