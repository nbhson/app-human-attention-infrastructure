# Wiring Map

> **Living document.** Every time an engine is registered in `apps/api/src/bootstrap.ts`, add a row here. It takes ~2 minutes and saves hours of archaeology later.

This table records the object graph built by `buildContainer()` (`apps/api/src/bootstrap.ts`) — the **only** place `new InProcessEventBus()` may appear (day-05 §6). Everything else asks the container for a token via `resolve(TOKENS.*)`.

## Legend

- **Token** — string key from `packages/di/src/tokens.ts`.
- **Concrete class / factory** — what the token resolves to.
- **Registered on** — day the registration (or its stub) first appeared.
- **Resolved by** — who pulls this token out of the container.

## Current graph (Phase 2 — Day 30)

Ordered as `buildContainer()` registers them, i.e. topologically.

| Token | Concrete class / factory | Registered on | Resolved by |
|---|---|---|---|
| `Logger` | `createRootLogger()` (pino) | Day 27 | `EventBus`, `EventLogWriter`, all subscribers, both loops, `ReviewService`, `MergeService`, `ReworkService`, `AttentionRouter`, `Dispatcher`/`DispatchLoop`, `RuntimePollLoop`, `AgentRunner` |
| `EventBus` | `InProcessEventBus(handler)` | Day 05 | `EventLogWriter`, every subscriber (`ArtifactCapture`/`ChangeStatus`/`Attention`), `AttentionRouter`, `TaskService`, `VerificationEngine`, `ToolRegistry`, `AgentRunner`, `Dispatcher`, `WorkflowRunner` |
| `Db` | `createDb(process.env.DATABASE_URL)` | Day 05 | everything that persists — `EventLogWriter`, `ArtifactTracker`, `ChangeStatusSubscriber`, `AttentionSubscriber`, `AttentionRouter`, `ContextEngine`, `ContextCache`, `CacheInvalidationListener`, `VerificationEngine`, `LoggingLLMProvider`, `TaskService`, `ReviewService` (+ `DiffEngine`), `MergeService`, `ReworkService`, `Dispatcher`, `WorkflowRunner`, `AgentRunner`, `TrajectoryRecorder`, `RuntimePollLoop` |
| `EventLogWriter` | `EventLogWriter(db, logger)` + `subscribeTo(EventBus)` | Day 05 | eager-resolved at boot (side effect: forwards bus events into `event_log`) |
| `OidcProvider` | `MockOidcProvider \| OpenIdClientProvider` (env-driven; `OIDC_MOCK`) | Day 30 | `AuthService` (browser login/callback exchange) |
| `SessionService` | `SessionService(db, ttlMs)` | Day 30 | `AuthService` (create/revoke/touch sessions) |
| `AuthService` | `AuthService(db, SessionService, {jwtSecret})` | Day 30 | `routes/auth.ts`, `apps/api/src/auth.ts` (hook decodes JWT + session) |
| `ContentStore` | `ObjectStoreContentStore(AwsS3ClientPort(...))` when `OBJECT_STORE_ENDPOINT` is set, else `InMemoryContentStore('object')` (ephemeral dev fallback) | Day 21 | `SnapshotStore` (large-content offload), `DiffEngine` / `AttentionSubscriber` / `MergeService` (read-back of offloaded snapshots) |
| `SnapshotStore` | `SnapshotStore(ContentStore, threshold)` (content-addressed dedup; `content` stays inline at/under the threshold, offloads above it — `content_backend` `'db'`/`'object'`) | Day 14 (seam: Day 21) | `ArtifactTracker` |
| `ArtifactTracker` | `ArtifactTracker(db, SnapshotStore)` | Day 14 | `ArtifactCaptureSubscriber` |
| `ArtifactCaptureSubscriber` | `ArtifactCaptureSubscriber(ArtifactTracker, logger)` + `subscribe(EventBus)` | Day 14 | eager-resolved at boot (side effect: `artifact.created` → tracker capture) |
| `ChangeStatusSubscriber` | `ChangeStatusSubscriber(db, logger)` + `subscribe(EventBus)` | Day 14 | eager-resolved at boot (side effect: **sole writer** of `changes.status` — `PENDING→VERIFIED→REVIEWED`, any→`ROLLED_BACK`) |
| `AttentionSubscriber` | `AttentionSubscriber(db, logger, WeightsProvider, ContentStore)` + `subscribe(EventBus)` | Day 18 (WeightsProvider seam: Day 12) | eager-resolved at boot (side effect: `task.state_changed`→`AWAITING_REVIEW` scores the five factors → `assessments` row → `attention.assessment_created`) |
| `AttentionRouter` | `AttentionRouter(db, EventBus, ATTENTION_POLICY_V1, logger)` + `subscribe()` | Day 19 | eager-resolved at boot (side effect: `attention.assessment_created` → policy match + fatigue controls → `review_queue` → `attention.item_routed`); `ReviewService` (feedback seam) |
| `AutoApproveGate` | `AutoApproveGate({ maxRisk, inflationCeiling })` (pure evaluator, no deps) | Day 14 | `AutoApproveExecutor` (the three-part gate — calibration green ∧ flag on ∧ under the bar) |
| `AutoApproveKillSwitch` | `AutoApproveKillSwitch(db)` (single-row `auto_approve_kill_switch`) | Day 14 | `AutoApproveExecutor` (reads flag/kill on every decision); `routes/admin.ts` (flag flip / kill) |
| `AutoApproveSampler` | `AutoApproveSampler(db, EventBus, logger)` + `subscribe()` | Day 14 | eager-resolved at boot (side effect: `decision.submitted` REJECTED on a sampled control → `attention.escalation_leakage`) |
| `AutoApproveExecutor` | `AutoApproveExecutor(db, EventBus, gate, killSwitch, sampler, taskTransition, policy, DbAutoApproveLoader(db), logger)` + `subscribe()` | Day 14 | eager-resolved at boot (side effect: `attention.item_routed` `AUTO_APPROVABLE` → gate → `AUTO_APPROVED` decision, `actor_id IS NULL`, task `AWAITING_REVIEW→APPROVED` under `triggered_by 'auto_approve'`) |
| `WeightsProvider` | `StaticWeightsAdapter()` (returns the Phase-1 placeholder) | Day 12 | `AttentionSubscriber` (threads the active vector into `computePriority`; **not flipped** — the Day-15 fit did not beat the placeholder) |
| `Embedder` | `StubEmbedder()` (default) \| `OpenAICompatibleEmbedder({baseUrl, apiKey, model})` when `EMBEDDINGS_BASE_URL` is set | Day 16 | `EmbeddingIndexer` (day-17), `SemanticRetriever` (day-18); the keyword path never reads it — shadow-negative test asserts zero calls |
| `EmbeddingIndexer` | `EmbeddingIndexer(db, Embedder, {}, Logger)` | Day 17 | `ReembedListener`; out-of-band `pnpm embed:populate` CLI (batch/resumable/idempotent population) |
| `ReembedListener` | `ReembedListener(db, EmbeddingIndexer, Logger)` + `subscribe(EventBus)` | Day 17 | eager-resolved at boot (side effect: `artifact.created`/`artifact.changed` → re-embed the FILE source keyed on `content_hash`; publishes nothing — day-17 §6) |
| `SemanticRetriever` | `SemanticRetriever(db, Embedder)` | Day 18 | cosine similarity over the populated index; **not** on the default resolve path (only reachable via `resolveWithShadow`) |
| `SemanticRanker` | `SemanticRanker(db, Embedder, SemanticRetriever)` | Day 18 | wraps the retriever with the freshness guard (day-17 §2.4) + target-file rule; **not** on the default resolve path |
| `ContextCache` | `PostgresContextCache(db)` | Day 20 | read-optimization leaf for the collector; `get(sourceId, contentHash)` is the truth, `getByStat(sourceId, mtime, size)` is the zero-read fast-path (§5.1); hit/miss mirrored onto `harness_context_cache_{hit,miss}_total` |
| `CacheInvalidationListener` | `CacheInvalidationListener(db, ContextCache, Logger)` + `subscribe(EventBus)` | Day 20 | eager-resolved at boot (side effect: `artifact.created` (inline `file_path`) / `artifact.changed` (resolves `artifact_id`→`file_path` via `artifacts`) → `invalidate`; publishes nothing) |
| `ContextEngine` | `ContextEngine(db, FileCollector(sandboxRoot, ContextCache), KeywordDependencyRanker(), TiktokenTokenizer(), Embedder, SemanticRanker)` | Day 20 (embedder seam: Day 16, semantic shadow: Day 18) | `COLLECT_CONTEXT` step handler (default `resolveContext`, keyword-only); `resolveWithShadow` is opt-in via `semanticShadowEnabled` |
| `EvidenceStore` | `EvidenceStore()` | Day 17 | `VerificationEngine` |
| `VerificationEngine` | `VerificationEngine(db, EventBus, {CompileCheck, TestCheck}, EvidenceStore)` | Day 15 (`CompileCheck`) / 16 (`TestCheck`) / 17 (`EvidenceStore`) | `VERIFY` step handler (publishes `verification.completed`) |
| `LLMProvider` | `LoggingLLMProvider(AnthropicProvider(key) \| MockLLM(script), db)` | Day 11 | `AgentRunner` |
| `TaskStateMachine` | `TaskStateMachine` (pure transition table, no deps) | Day 06 | `TaskService` |
| `TaskService` | `TaskService(db, EventBus, TaskStateMachine)` | Day 06 | `ReviewService` (transition seam), `MergeService`, `ReworkService`, `Dispatcher`, `WorkflowRunner`, `AgentRunner`, verify/context handlers |
| `ReviewService` | `ReviewService(db, EventBus, {transitionTask, reportAssessmentFeedback, diffChange}, logger)` | Day 22 (surface: Day 24) | `routes/review.ts` (claim/decide/drop + day-24 release/escalate); `DiffEngine` is constructed inline to back `diffChange`. Day-24 surface emits `review.item_claimed`/`review.item_released`/`review.item_escalated` into the event catalog on the Spec 8 §2.2 transitions |
| `GitAdapter` | `ShellGitAdapter(process.env.WORKING_REPO_ROOT)` | Day 24 | `MergeService` |
| `MergeService` | `MergeService(db, EventBus, GitAdapter, TaskService, logger, ContentStore)` + `subscribe()` | Day 24 (seam: Day 21) | eager-resolved at boot (side effect: APPROVED → merge → `artifact.merged`) |
| `ReworkService` | `ReworkService(db, EventBus, TaskService, logger)` + `subscribe()` | Day 24 | eager-resolved at boot (side effect: REJECTED → REWORK) |
| `Dispatcher` | `Dispatcher(db, TaskService, EventBus)` | Day 08 | `DispatchLoop` (drives `PENDING`/`REWORK` → `QUEUED`/`FAILED`) |
| `DispatchLoop` | `DispatchLoop(Dispatcher, logger)` | Day 08 | `apps/api` startup (start/stop on SIGTERM/SIGINT) |
| `WorkflowRunner` | `WorkflowRunner(db, TaskService, {COLLECT_CONTEXT, EXECUTE, VERIFY})` | Day 09 (handlers: COLLECT_CONTEXT Day 20, EXECUTE stub, VERIFY Day 15) | `AgentRunner` completion handoff (`runLinearWorkflow`) |
| `ToolRegistry` | `ToolRegistry(ToolAllowlist, EventBus)` + `read_file`/`write_file`/`list_directory` | Day 13 | `AgentRunner` |
| `TrajectoryRecorder` | `TrajectoryRecorder(db)` | Day 13 | `AgentRunner` (per-step audit trail into `trajectory_steps`) |
| `AgentRunner` | `AgentRunner(db, EventBus, LLMProvider, ToolRegistry, TaskService, {runLinearWorkflow}, maxSteps, tokenLimit, TrajectoryRecorder)` | Day 12 | `RuntimePollLoop` |
| `RuntimePollLoop` | `RuntimePollLoop(db, AgentRunner, logger)` | Day 12 | `apps/api` startup (start/stop on SIGTERM/SIGINT) |
| `MetricsComputer` | `MetricsComputer()` (stateless, pure — offline) | Day 06 | Day 07 report generator (`EVAL_REPORT_SCHEDULE` cron); the `pnpm eval:metrics` CLI constructs it directly (out-of-band) today |
| `Orchestrator` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (the real work landed in `Dispatcher` + `DispatchLoop` + `WorkflowRunner`) |
| `AgentRuntime` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (the real work landed in `AgentRunner` + `RuntimePollLoop`) |
| `AttentionEngine` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (the real work landed in `AttentionSubscriber` + `AttentionRouter`) |

The three `ENGINE_STUB_TOKENS` (`Orchestrator`, `AgentRuntime`, `AttentionEngine`) are the
Day-05 placeholder names. Their concrete behaviour was built under more specific
tokens instead, so the stubs persist — they are never resolved and that is fine.
`bootContainer()` (below) deliberately resolves only the subscriber/service tokens.

### Startup recovery (not a token)

Before any loop starts, `apps/api/src/index.ts` calls
`reconcileOrphans(db, TaskService, EventBus, Logger)` (imported from
`apps/api/src/reconcile.ts`, **Day 28**). It is deliberately *not* a container
token: it is a one-shot, single-writer boot step, not a resolvable dependency.
Order matters — `reconcileOrphans` must run before `dispatchLoop.start()` /
`runtimePollLoop.start()`, or an orphaned `EXECUTING`/`VERIFYING` row could be
double-run (day-28 §6).

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
generator wants a plain-number snapshot, not prom-client aggregation types. The
Day-07 report reads that snapshot (via `MetricsComputer`'s `infra` section, fed by
`loadMetricsInput.shadowLog` from `shadow_rank_comparisons` for the `shadow`
section, plus a literal `rankMethod: 'keyword'`) — see the "Offline evaluation"
note below.

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

**Day-25 report sections.** `ReportGenerator.generate` now emits three top-level
sections alongside the stable five-line `lines` array: `shadow` (from
`MetricsInput.shadowLog`, loaded by `loadMetricsInput` from
`shadow_rank_comparisons` over the window), `infra` (from `MetricsInput.infraCounters`,
a `snapshotInfraCounters()` read the CLI/report-cli inject — cache-hit ratio,
sandbox fallback rate + latency, object-integrity errors, each an honest
`undefined` when its denominator is zero), and `rankMethod: 'keyword'` (the served
keyword-vs-semantic invariant made visible). New `MetricsInput`/`MetricsReport`
fields are **optional** so the prior Phase-1 report shape still typechecks, and
the `lines` array is untouched.

**Week-1 checkpoint (day-05):** the full identity + observability stack is
registered and resolvable — `OidcProvider` (`MockOidcProvider`|`OpenIdClientProvider`)
→ `SessionService` → `AuthService` hook (`apps/api/src/auth.ts`), all under the
per-request `http.request` root span; metrics on the process-global
prom-client `register` served by `GET /metrics`. Nothing here is a DI token —
tracing/metrics are `@harness/observability` module singletons, surfaced via
`initApiTracing(container)` (see above).

## Eager resolution (`bootContainer`)

Registrations are lazy, but bus subscriptions are **side effects** — so
`bootContainer(c)` (called by both `index.ts` and the Day-25 E2E driver) resolves
every token whose constructor (or `subscribe()`) must bind to the bus before any
task runs:

```text
EventLogWriter   ArtifactCaptureSubscriber   ChangeStatusSubscriber
AttentionSubscriber   AttentionRouter   AutoApproveSampler   AutoApproveExecutor
ContextEngine
ReembedListener
CacheInvalidationListener
ReviewService   MergeService   ReworkService
```

The two loops (`DispatchLoop`, `RuntimePollLoop`) are **not** resolved here — their
`start()`/`stop()` is driven explicitly by the server lifecycle, after the reconciler.

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
12. `WeightsProvider` — no deps (returns the Phase-1 placeholder via `StaticWeightsAdapter`; not flipped until Day 13/14).
13. `AttentionSubscriber` — needs `Db`, `Logger`, `WeightsProvider`, `ContentStore`, `EventBus`.
14. `AttentionRouter` — needs `Db`, `EventBus`, `ATTENTION_POLICY_V1`, `Logger`.
15. `AutoApproveGate` — needs `ATTENTION_POLICY_V1` (static tuning; pure evaluator, no container deps).
16. `AutoApproveKillSwitch` — needs `Db`.
17. `AutoApproveSampler` — needs `Db`, `EventBus`, `Logger`.
18. `AutoApproveExecutor` — needs `Db`, `EventBus`, `AutoApproveGate`, `AutoApproveKillSwitch`, `AutoApproveSampler`, `ATTENTION_POLICY_V1`, `DbAutoApproveLoader(Db)`, and the `taskTransition` seam onto `TaskService` (lazy-resolved — registered before `TaskService`, wired at boot).
19. `Embedder` — no deps (`StubEmbedder` default; `OpenAICompatibleEmbedder` when `EMBEDDINGS_BASE_URL` is set).
20. `EmbeddingIndexer` — needs `Db`, `Embedder`, `Logger`.
21. `ReembedListener` — needs `Db`, `EmbeddingIndexer`, `Logger`, `EventBus`; `subscribe(EventBus)` at registration (side effect).
22. `SemanticRetriever` — needs `Db`, `Embedder`.
23. `SemanticRanker` — needs `Db`, `Embedder`, `SemanticRetriever`.
24. `ContextCache` — needs `Db` (Postgres-backed `context_source_cache`; no Redis — modular-monolith rule).
25. `CacheInvalidationListener` — needs `Db`, `ContextCache`, `Logger`, `EventBus`; `subscribe(EventBus)` at registration (side effect).
26. `ContextEngine` — needs `Db`, `FileCollector(sandboxRoot, ContextCache)`, `KeywordDependencyRanker()`, `TiktokenTokenizer()`, `Embedder`, `SemanticRanker`.
27. `EvidenceStore` — no deps.
28. `VerificationEngine` — needs `Db`, `EventBus`, `{CompileCheck, TestCheck}`, `EvidenceStore`.
29. `LLMProvider` — needs `Db`, plus `ANTHROPIC_API_KEY` to pick the real adapter (else `MockLLM`, scripted by `MOCK_LLM_SCRIPT`).
30. `TaskStateMachine` — no deps.
31. `TaskService` — needs `Db`, `EventBus`, `TaskStateMachine`.
32. `ReviewService` — needs `Db`, `EventBus`, three structural seams, `Logger`.
33. `GitAdapter` — needs `WORKING_REPO_ROOT`.
34. `MergeService` — needs `Db`, `EventBus`, `GitAdapter`, `TaskService`, `Logger`, `ContentStore`.
35. `ReworkService` — needs `Db`, `EventBus`, `TaskService`, `Logger`.
36. `Dispatcher` — needs `Db`, `TaskService`, `EventBus`.
37. `DispatchLoop` — needs `Dispatcher`, `Logger`.
38. `WorkflowRunner` — needs `Db`, `TaskService`, step handlers (`COLLECT_CONTEXT` real, `EXECUTE` stub, `VERIFY` real).
39. `ToolRegistry` — needs `EventBus`, `AGENT_ALLOWED_TOOLS`, `SANDBOX_ROOT`.
40. `TrajectoryRecorder` — needs `Db`.
41. `AgentRunner` — needs `Db`, `EventBus`, `LLMProvider`, `ToolRegistry`, `TaskService`, the `runLinearWorkflow` handoff, `maxSteps`, `tokenLimit`, `TrajectoryRecorder`.
42. `RuntimePollLoop` — needs `Db`, `AgentRunner`, `Logger`.
43. `Orchestrator` / `AgentRuntime` / `AttentionEngine` — stubs (see above).

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
| R8 | `observability` → `domain`, `db`, `di` only; every telemetry-carrying engine (`orchestrator`, `agent-runtime`, `attention-engine`, `verification-engine`) depends on it | same (day-03) |
| R9 | `evaluation` → `domain`, `db`, `di`, `observability` only (never an engine) | same (day-06) |
| R10 | `embeddings` → `domain`, `db`, `event-bus` only (never `di`, `observability`, or an engine) | same (day-16 §2.4, widened day-17) |
| R11 | `object-store` → no `@harness/*` dependency (pure content-addressed leaf seam) | same (day-21 §2.1) |
| R12 | `sandbox` → no `@harness/*` dependency (pure leaf seam) | same (day-22 §2.1) |

The authoritative assertions live in `packages/di/src/__tests__/architecture.test.ts`; the lint rule catches violations at edit time (see `eslint.config.mjs`).