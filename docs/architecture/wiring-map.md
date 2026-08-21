# Wiring Map

> **Living document.** Every time an engine is registered in `apps/api/src/bootstrap.ts`, add a row here. It takes ~2 minutes and saves hours of archaeology later.

This table records the object graph built by `buildContainer()` (`apps/api/src/bootstrap.ts`) — the **only** place `new InProcessEventBus()` may appear (day-05 §6). Everything else asks the container for a token via `resolve(TOKENS.*)`.

## Legend

- **Token** — string key from `packages/di/src/tokens.ts`.
- **Concrete class / factory** — what the token resolves to.
- **Registered on** — day the registration (or its stub) first appeared.
- **Resolved by** — who pulls this token out of the container.

## Current graph

| Token | Concrete class / factory | Registered on | Resolved by |
|---|---|---|---|
| `EventBus` | `InProcessEventBus` | Day 03 (built) / Day 05 (registered) | `EventLogWriter`, `ArtifactCaptureSubscriber`, `ChangeStatusSubscriber`, `TaskService`, `ToolRegistry`, all engines |
| `Db` | `createDb(process.env.DATABASE_URL)` | Day 04 (built) / Day 05 (registered) | `EventLogWriter`, `ArtifactCaptureSubscriber`, `TaskService`, `LLMProvider` (via `LoggingLLMProvider`), `TrajectoryRecorder`, `ArtifactTracker`, `ContextEngine`, `VerificationEngine`, `AttentionEngine`, `Orchestrator`, Review API |
| `EventLogWriter` | `EventLogWriter(db)` + `subscribeTo(EventBus)` | Day 04 (built) / Day 05 (registered) | bootstrap (side effect: forwards bus events into `event_log`) |
| `ArtifactCaptureSubscriber` | `ArtifactCaptureSubscriber(ArtifactTracker)` + `subscribe(EventBus)` | Day 13 (stub) / Day 14 (real) | bootstrap (side effect: `artifact.created` → tracker capture) |
| `SnapshotStore` | `SnapshotStore()` (content-addressed dedup) | Day 14 | `ArtifactTracker` |
| `ChangeStatusSubscriber` | `ChangeStatusSubscriber(db)` + `subscribe(EventBus)` | Day 14 | bootstrap (side effect: sole writer of `changes.status`) |
| `TaskStateMachine` | `TaskStateMachine` (pure transition table, no deps) | Day 06 | `TaskService` |
| `TaskService` | `TaskService(db, EventBus, TaskStateMachine)` | Day 06 | Review API, `Dispatcher`, `WorkflowRunner` |
| `Dispatcher` | `Dispatcher(db, TaskService)` | Day 08 | `DispatchLoop` (drives `PENDING`/`REWORK` → `QUEUED`/`FAILED`) |
| `DispatchLoop` | `DispatchLoop(Dispatcher)` | Day 08 | `apps/api` startup (start/stop on SIGTERM/SIGINT) |
| `WorkflowRunner` | `WorkflowRunner(db, TaskService, step handlers)` | Day 09 | `AgentRunner` (completion handoff, Day 12) |
| `LLMProvider` | `LoggingLLMProvider(AnthropicProvider(apiKey) \| MockLLM([]), db)` | Day 11 | `AgentRunner` → `ReActLoop` (Day 12) |
| `ToolRegistry` | `ToolRegistry(ToolAllowlist, EventBus)` registered with `read_file`/`write_file`/`list_directory` | Day 12 | `AgentRunner` |
| `AgentRunner` | `AgentRunner(db, EventBus, LLMProvider, ToolRegistry, TaskService, handoff, maxSteps, tokenLimit, TrajectoryRecorder)` | Day 12 | `RuntimePollLoop` |
| `RuntimePollLoop` | `RuntimePollLoop(db, AgentRunner)` | Day 12 | `apps/api` startup (start/stop on SIGTERM/SIGINT) |
| `TrajectoryRecorder` | `TrajectoryRecorder(db)` | Day 13 | `AgentRunner` (per-step audit trail into `trajectory_steps`) |
| `Orchestrator` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl Day 09+: linear workflow) |
| `AgentRuntime` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl Day 06+) |
| `ContextEngine` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl Day 07+) |
| `ArtifactTracker` | `ArtifactTracker(db, SnapshotStore)` | Day 14 | `ArtifactCaptureSubscriber` |
| `AttentionEngine` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl later) |
| `VerificationEngine` | `VerificationEngine(db, EventBus, { checks: [new CompileCheck()] })` | Day 15 | VERIFY step handler of `WorkflowRunner` (drives `verify()` → publishes `verification.completed`) |

## Bootstrap order (topological)

1. `EventBus` — no deps.
2. `Db` — needs `DATABASE_URL`.
3. `EventLogWriter` — needs `Db`, `EventBus`.
4. `ArtifactTracker` — needs `Db`, `SnapshotStore`.
5. `ArtifactCaptureSubscriber` — needs `ArtifactTracker`, `EventBus`.
6. `ChangeStatusSubscriber` — needs `Db`, `EventBus`.
7. `VerificationEngine` — needs `Db`, `EventBus`, plus its check set (Phase 1: `CompileCheck`). Resolved by the VERIFY step handler.
8. `TaskStateMachine` — no deps.
9. `TaskService` — needs `Db`, `EventBus`, `TaskStateMachine`.
10. `Dispatcher` — needs `Db`, `TaskService`.
11. `DispatchLoop` — needs `Dispatcher`.
12. `WorkflowRunner` — needs `Db`, `TaskService`, step handlers (`COLLECT_CONTEXT`/`EXECUTE` stubs, real `VERIFY` → `VerificationEngine`).
13. `LLMProvider` — needs `Db`, plus `ANTHROPIC_API_KEY` to pick the real adapter; falls back to an empty `MockLLM`.
14. `ToolRegistry` — needs `EventBus` + `AGENT_ALLOWED_TOOLS`; registers `read_file`/`write_file`/`list_directory` into `SANDBOX_ROOT`.
15. `TrajectoryRecorder` — needs `Db`.
16. `AgentRunner` — needs `Db`, `EventBus`, `LLMProvider`, `ToolRegistry`, `TaskService`, `TrajectoryRecorder`, plus the `WorkflowRunner` completion handoff.
17. `RuntimePollLoop` — needs `Db`, `AgentRunner`.
18. Engine slots — `Orchestrator`/`AgentRuntime`/`ContextEngine`/`AttentionEngine` registered as stubs today; wired on their build days.

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