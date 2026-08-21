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
| `EventBus` | `InProcessEventBus` | Day 03 (built) / Day 05 (registered) | `EventLogWriter`, `TaskService`, all engines |
| `Db` | `createDb(process.env.DATABASE_URL)` | Day 04 (built) / Day 05 (registered) | `EventLogWriter`, `TaskService`, `ArtifactTracker`, `ContextEngine`, `VerificationEngine`, `AttentionEngine`, `Orchestrator`, Review API |
| `EventLogWriter` | `EventLogWriter(db)` + `subscribeTo(EventBus)` | Day 04 (built) / Day 05 (registered) | bootstrap (side effect: forwards bus events into `event_log`) |
| `TaskStateMachine` | `TaskStateMachine` (pure transition table, no deps) | Day 06 | `TaskService` |
| `TaskService` | `TaskService(db, EventBus, TaskStateMachine)` | Day 06 | Review API, `Dispatcher`, `WorkflowRunner` |
| `Dispatcher` | `Dispatcher(db, TaskService)` | Day 08 | `DispatchLoop` (drives `PENDING`/`REWORK` → `QUEUED`/`FAILED`) |
| `DispatchLoop` | `DispatchLoop(Dispatcher)` | Day 08 | `apps/api` startup (start/stop on SIGTERM/SIGINT) |
| `WorkflowRunner` | `WorkflowRunner(db, TaskService, step handlers)` | Day 09 | Agent Runtime completion handler (Day 12) |
| `Orchestrator` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl Day 09+: linear workflow) |
| `AgentRuntime` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl Day 06+) |
| `ContextEngine` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl Day 07+) |
| `ArtifactTracker` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl later) |
| `AttentionEngine` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl later) |
| `VerificationEngine` | stub `Proxy` ("not yet implemented") | Day 05 (stub) | — (real impl later) |

## Bootstrap order (topological)

1. `EventBus` — no deps.
2. `Db` — needs `DATABASE_URL`.
3. `EventLogWriter` — needs `Db`, `EventBus`.
4. `TaskStateMachine` — no deps.
5. `TaskService` — needs `Db`, `EventBus`, `TaskStateMachine`.
6. `Dispatcher` — needs `Db`, `TaskService`.
7. `DispatchLoop` — needs `Dispatcher`.
8. `WorkflowRunner` — needs `Db`, `TaskService`, step handlers (Phase 1 stubs).
9. Engine slots — registered as stubs today; wired to `IEventBus`/`Db` on their build days.

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