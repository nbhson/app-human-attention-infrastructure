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
| `Db` | `createDb(process.env.DATABASE_URL)` | Day 05 | everything that persists — `EventLogWriter`, `ArtifactTracker`, `ChangeStatusSubscriber`, `AttentionSubscriber`, `AttentionRouter`, `ContextEngine`, `VerificationEngine`, `LoggingLLMProvider`, `TaskService`, `ReviewService` (+ `DiffEngine`), `MergeService`, `ReworkService`, `Dispatcher`, `WorkflowRunner`, `AgentRunner`, `TrajectoryRecorder`, `RuntimePollLoop` |
| `EventLogWriter` | `EventLogWriter(db, logger)` + `subscribeTo(EventBus)` | Day 05 | eager-resolved at boot (side effect: forwards bus events into `event_log`) |
| `OidcProvider` | `MockOidcProvider \| OpenIdClientProvider` (env-driven; `OIDC_MOCK`) | Day 30 | `AuthService` (browser login/callback exchange) |
| `SessionService` | `SessionService(db, ttlMs)` | Day 30 | `AuthService` (create/revoke/touch sessions) |
| `AuthService` | `AuthService(db, SessionService, {jwtSecret})` | Day 30 | `routes/auth.ts`, `apps/api/src/auth.ts` (hook decodes JWT + session) |
| `SnapshotStore` | `SnapshotStore()` (content-addressed dedup) | Day 14 | `ArtifactTracker` |
| `ArtifactTracker` | `ArtifactTracker(db, SnapshotStore)` | Day 14 | `ArtifactCaptureSubscriber` |
| `ArtifactCaptureSubscriber` | `ArtifactCaptureSubscriber(ArtifactTracker, logger)` + `subscribe(EventBus)` | Day 14 | eager-resolved at boot (side effect: `artifact.created` → tracker capture) |
| `ChangeStatusSubscriber` | `ChangeStatusSubscriber(db, logger)` + `subscribe(EventBus)` | Day 14 | eager-resolved at boot (side effect: **sole writer** of `changes.status` — `PENDING→VERIFIED→REVIEWED`, any→`ROLLED_BACK`) |
| `AttentionSubscriber` | `AttentionSubscriber(db, logger)` + `subscribe(EventBus)` | Day 18 | eager-resolved at boot (side effect: `task.state_changed`→`AWAITING_REVIEW` scores the five factors → `assessments` row → `attention.assessment_created`) |
| `AttentionRouter` | `AttentionRouter(db, EventBus, ATTENTION_POLICY_V1, logger)` + `subscribe()` | Day 19 | eager-resolved at boot (side effect: `attention.assessment_created` → policy match + fatigue controls → `review_queue` → `attention.item_routed`); `ReviewService` (feedback seam) |
| `ContextEngine` | `ContextEngine(db, FileCollector(sandboxRoot))` | Day 20 | `COLLECT_CONTEXT` step handler |
| `EvidenceStore` | `EvidenceStore()` | Day 17 | `VerificationEngine` |
| `VerificationEngine` | `VerificationEngine(db, EventBus, {CompileCheck, TestCheck}, EvidenceStore)` | Day 15 (`CompileCheck`) / 16 (`TestCheck`) / 17 (`EvidenceStore`) | `VERIFY` step handler (publishes `verification.completed`) |
| `LLMProvider` | `LoggingLLMProvider(AnthropicProvider(key) \| MockLLM(script), db)` | Day 11 | `AgentRunner` |
| `TaskStateMachine` | `TaskStateMachine` (pure transition table, no deps) | Day 06 | `TaskService` |
| `TaskService` | `TaskService(db, EventBus, TaskStateMachine)` | Day 06 | `ReviewService` (transition seam), `MergeService`, `ReworkService`, `Dispatcher`, `WorkflowRunner`, `AgentRunner`, verify/context handlers |
| `ReviewService` | `ReviewService(db, EventBus, {transitionTask, reportAssessmentFeedback, diffChange}, logger)` | Day 22 | `routes/review.ts` (claim/decide/drop); `DiffEngine` is constructed inline to back `diffChange` |
| `GitAdapter` | `ShellGitAdapter(process.env.WORKING_REPO_ROOT)` | Day 24 | `MergeService` |
| `MergeService` | `MergeService(db, EventBus, GitAdapter, TaskService, logger)` + `subscribe()` | Day 24 | eager-resolved at boot (side effect: APPROVED → merge → `artifact.merged`) |
| `ReworkService` | `ReworkService(db, EventBus, TaskService, logger)` + `subscribe()` | Day 24 | eager-resolved at boot (side effect: REJECTED → REWORK) |
| `Dispatcher` | `Dispatcher(db, TaskService, EventBus)` | Day 08 | `DispatchLoop` (drives `PENDING`/`REWORK` → `QUEUED`/`FAILED`) |
| `DispatchLoop` | `DispatchLoop(Dispatcher, logger)` | Day 08 | `apps/api` startup (start/stop on SIGTERM/SIGINT) |
| `WorkflowRunner` | `WorkflowRunner(db, TaskService, {COLLECT_CONTEXT, EXECUTE, VERIFY})` | Day 09 (handlers: COLLECT_CONTEXT Day 20, EXECUTE stub, VERIFY Day 15) | `AgentRunner` completion handoff (`runLinearWorkflow`) |
| `ToolRegistry` | `ToolRegistry(ToolAllowlist, EventBus)` + `read_file`/`write_file`/`list_directory` | Day 13 | `AgentRunner` |
| `TrajectoryRecorder` | `TrajectoryRecorder(db)` | Day 13 | `AgentRunner` (per-step audit trail into `trajectory_steps`) |
| `AgentRunner` | `AgentRunner(db, EventBus, LLMProvider, ToolRegistry, TaskService, {runLinearWorkflow}, maxSteps, tokenLimit, TrajectoryRecorder)` | Day 12 | `RuntimePollLoop` |
| `RuntimePollLoop` | `RuntimePollLoop(db, AgentRunner, logger)` | Day 12 | `apps/api` startup (start/stop on SIGTERM/SIGINT) |
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

## Eager resolution (`bootContainer`)

Registrations are lazy, but bus subscriptions are **side effects** — so
`bootContainer(c)` (called by both `index.ts` and the Day-25 E2E driver) resolves
every token whose constructor (or `subscribe()`) must bind to the bus before any
task runs:

```text
EventLogWriter   ArtifactCaptureSubscriber   ChangeStatusSubscriber
AttentionSubscriber   AttentionRouter   ContextEngine
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
8. `SnapshotStore` — no deps.
9. `ArtifactTracker` — needs `Db`, `SnapshotStore`.
10. `ArtifactCaptureSubscriber` — needs `ArtifactTracker`, `Logger`, `EventBus`.
11. `ChangeStatusSubscriber` — needs `Db`, `Logger`, `EventBus`.
12. `AttentionSubscriber` — needs `Db`, `Logger`, `EventBus`.
13. `AttentionRouter` — needs `Db`, `EventBus`, `ATTENTION_POLICY_V1`, `Logger`.
14. `ContextEngine` — needs `Db`, `FileCollector(sandboxRoot)`.
15. `EvidenceStore` — no deps.
16. `VerificationEngine` — needs `Db`, `EventBus`, `{CompileCheck, TestCheck}`, `EvidenceStore`.
17. `LLMProvider` — needs `Db`, plus `ANTHROPIC_API_KEY` to pick the real adapter (else `MockLLM`, scripted by `MOCK_LLM_SCRIPT`).
18. `TaskStateMachine` — no deps.
19. `TaskService` — needs `Db`, `EventBus`, `TaskStateMachine`.
20. `ReviewService` — needs `Db`, `EventBus`, three structural seams, `Logger`.
21. `GitAdapter` — needs `WORKING_REPO_ROOT`.
22. `MergeService` — needs `Db`, `EventBus`, `GitAdapter`, `TaskService`, `Logger`.
23. `ReworkService` — needs `Db`, `EventBus`, `TaskService`, `Logger`.
24. `Dispatcher` — needs `Db`, `TaskService`, `EventBus`.
25. `DispatchLoop` — needs `Dispatcher`, `Logger`.
26. `WorkflowRunner` — needs `Db`, `TaskService`, step handlers (`COLLECT_CONTEXT` real, `EXECUTE` stub, `VERIFY` real).
27. `ToolRegistry` — needs `EventBus`, `AGENT_ALLOWED_TOOLS`, `SANDBOX_ROOT`.
28. `TrajectoryRecorder` — needs `Db`.
29. `AgentRunner` — needs `Db`, `EventBus`, `LLMProvider`, `ToolRegistry`, `TaskService`, the `runLinearWorkflow` handoff, `maxSteps`, `tokenLimit`, `TrajectoryRecorder`.
30. `RuntimePollLoop` — needs `Db`, `AgentRunner`, `Logger`.
28. `Orchestrator` / `AgentRuntime` / `AttentionEngine` — stubs (see above).

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

The authoritative assertions live in `packages/di/src/__tests__/architecture.test.ts`; the lint rule catches violations at edit time (see `eslint.config.mjs`).