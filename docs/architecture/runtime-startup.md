# Runtime Startup — what loads, and how it wires together

> **Living document.** When a package is added, promoted, or retired, update the
> entry-point table below. The authoritative source of truth is
> `apps/api/src/bootstrap.ts` (`buildContainer()` + `bootContainer()`) and
> `apps/api/src/index.ts` — read those first, then this.
>
> **Status:** v1.0-candidate (as-built) · 25 `@harness/*` packages + 2 apps.

This answers, concretely, "when I start the app, which packages actually load,
and how do they depend on each other?" It accompanies
[`wiring-map.md`](wiring-map.md) (the DI object graph, token by token) and the
[architecture spec](HAI_Harness_Architecture_v0.6.md) (the architecture and invariants
view). This file is about the **runtime**, not the design history.

---

## TL;DR

- **Two apps, two runtime modes.** `apps/api` (Fastify server) is the whole
  runtime: it pulls in **23 of the 25 packages** the moment it boots. `apps/web`
  (React/Vite) is a standalone client that imports **no** `@harness/*` package —
  it talks to `apps/api` over HTTP only.
- **2 packages never load at server boot** — `@harness/code-index` and
  `@harness/benchmark` are **CLI/out-of-band only** (they run from
  `apps/api/scripts/*` and `package.json` scripts, not from `index.ts`).
- **Loading is lazy.** Registering a package into the DI container
  (`buildContainer`) does **not** execute it — it only stores a factory. Only 11
  tokens are **eagerly resolved** at boot (`bootContainer`); everything else
  materialises on first use.
- **The graph is a layered modular monolith.** Leaves import nothing; engines
  import only the shared foundation (`domain`/`event-bus`/`db`/`di`); only the
  `apps/*` layer may import across the board.

---

## The three entry points

| Entry point | File | Loads | Runtime mode |
| --- | --- | --- | --- |
| **API server** | `apps/api/src/index.ts` | 23/25 `@harness/*` packages | Always on — this *is* the product |
| **Web client** | `apps/web/src/main.tsx` (Vite) | 0 `@harness/*` packages | Browser SPA; HTTP → API |
| **CLI scripts** | `apps/api/scripts/*.ts` | `@harness/code-index`, `@harness/benchmark` (+ helpers) | Out-of-band, on demand |

`@harness/code-index` is imported only by `apps/api/scripts/demo-verification.ts`;
`@harness/benchmark` only by `apps/api/scripts/{benchmark-regression,judge-agreement-report,calibration-report}.ts`.
Neither appears anywhere under `apps/api/src/`, so neither loads on server boot.

---

## The startup sequence (server)

`apps/api/src/index.ts` is the only server entry point. Starting the app walks six
stages in a fixed order; the one-line story is **nothing "runs" until stage 5 —
stages 1–4 only *prepare* the graph.**

```text
start app  (pnpm dev / node apps/api)
  └─ 1. dotenv            load .env → ../../.env          env (creds, toggles)
  └─ 2. buildContainer()  register 47 real + 3 stub      object graph (factories only, no engine runs)
  └─ 3. initApiTracing()  resolve Db + Logger → initTracing   OTel provider (module global)
  └─ 4. buildApp()        Fastify: trace hook → auth hook → 9 route groups
  └─ 5. bootContainer()   resolve the 11 eager tokens      bus subscribers bind (first engine code)
  └─ 6. app.listen()      { port: 3000, host: '0.0.0.0' }  serve traffic
```

### Stage by stage

| # | Stage | Source | What actually starts here |
| --- | --- | --- | --- |
| 1 | `.env` load | `index.ts:18` | Read creds + toggles from `.env`, then `../../.env` (first existing wins; an already-exported `DATABASE_URL` is never overridden) |
| 2 | `buildContainer()` | `index.ts:28` → `bootstrap.ts:202` | Register every token as a **lazy factory** — no engine is constructed. One real side effect: `mkdirSync(SANDBOX_ROOT)` |
| 3 | `initApiTracing()` | `index.ts:31` → `observability.ts` | The first *resolutions*: `Db` + `Logger` are constructed, then the OpenTelemetry provider is installed (module-global singleton) with `trace_correlation` write-through |
| 4 | `buildApp()` | `index.ts:32` → `app.ts:29` | Build the Fastify server: `/health`, the trace hook, the auth hook, then 9 route groups (auth · review · reviews · provenance · ops · metrics · admin · settings · learning). Handlers run only on a request. (Between this and stage 5, `index.ts:33-35` logs each registered token — informational only) |
| 5 | `bootContainer()` | `index.ts:37` → `bootstrap.ts:777` | Resolve the **11 eager tokens** — the first engine code that runs (the list below) |
| 6 | `app.listen()` | `index.ts:41` | Bind `0.0.0.0:3000` and serve. The process is now idle until a request arrives |

Key property: **stage 2 executes no engine code.** `Container.register(token, factory)`
stores a lazy factory. It is `bootContainer()` (stage 5) — and, later, the first
route that touches a token — that actually constructs objects. That is why the app
can boot *with most external providers unconfigured*: a `null` provider or a stub
embedder is a perfectly valid graph node; it fails loudly only if a request
actually tries to use it.

### What `bootContainer()` starts (the 11 eager tokens)

Resolved in this order because their constructor (or `subscribe()`) must **bind to
the event bus before the first request** — a side effect, not a value:

```text
1.  EventLogWriter            starts appending every bus event → event_log (append-only audit trail)
2.  ArtifactCaptureSubscriber starts listening for artifact.created → snapshot capture
3.  ChangeStatusSubscriber    starts listening → drives changes.status (PENDING→VERIFIED→REVIEWED, any→ROLLED_BACK)
4.  AttentionSubscriber       starts listening for task.state_changed → scores → attention.assessment_created
5.  AttentionRouter           subscribes → assessment_created → fatigue control → review_queue routing
6.  AutoApproveSampler        subscribes (the silent human control duplicate)
7.  AutoApproveExecutor       subscribes → acts on AUTO_APPROVABLE routed items → APPROVED
8.  ContextEngine             constructed — collect→rank→trim pipeline is built at boot, ready for the first request
9.  ReembedListener           starts listening for artifact.created/changed → re-embed affected files
10. ReviewService             constructed — wires transitionTask / feedback / diff seams at the composition root
11. JudgeShadow               subscribes → runs the shadow judge after review.report_created (log-only)
```

`AutoApproveGate` and `AutoApproveKillSwitch` are constructed *transitively* here as
inputs to `AutoApproveExecutor` (they have no bus subscription of their own).
`@harness/memory`'s `MemoryStore` and `MemoryLifecycle` are registered but **not**
eagerly started — the bootstrap comments mark them "no eager boot required"; the
lifecycle tick runs on a cadence from a separate entrypoint, not at boot.

Every other token is **lazy** — it materialises the first time a route asks for it.
The review slice in particular (`ReviewIngestService` / `ReviewAgent` /
`GitProvider` / `TicketProvider` / `WriteBackService`) resolves on the first
`POST /api/reviews`, not at boot.

---

## Dependency model — layers

Boundary rules **R1–R14** (enforced by `eslint-plugin-boundaries` +
`packages/di/src/__tests__/architecture.test.ts`) define exactly who may import
whom. Read top-down; **dependencies point upward**, and no arrow crosses a layer
boundary except the `apps/*` layer, which may import anything.

```text
Layer 5 — apps (composition roots; may import anything)
          apps/api ──────────────── apps/web (no @harness deps)
                        ▲
Layer 4 — review slice + learning seams (depend on foundation/engines)
          review  memory  judge  writeback  git-provider  ticket-provider
                        ▲
Layer 3 — engines (depend only on domain/event-bus/db/di + observability)
          orchestrator  agent-runtime  artifact-tracker  verification-engine
          attention-engine  context-engine  auth  embeddings  evaluation
                        ▲
Layer 2 — persistence + telemetry
          db (→ domain, event-bus)          observability (→ domain, db, di)
                        ▲
Layer 1 — shared foundation
          domain (imports nothing)  event-bus (→ domain)  di (→ domain)
                        ▲
Layer 0 — pure leaf seams (import NO @harness/* package)
          object-store  sandbox  mcp  code-index
```

The canonical edges (from each package's `package.json`, self-edges omitted):

| Package | Depends on (`@harness/*`) |
| --- | --- |
| `domain` | — (imports nothing) |
| `event-bus` | `domain` |
| `di` | `domain` |
| `object-store` | — |
| `sandbox` | — |
| `mcp` | — |
| `code-index` | — |
| `git-provider` | `domain`, `mcp` |
| `ticket-provider` | `domain`, `mcp` |
| `db` | `domain`, `event-bus` |
| `observability` | `domain`, `db`, `di` |
| `auth` | `domain`, `db`, `event-bus`, `di` |
| `embeddings` | `domain`, `db`, `event-bus` |
| `orchestrator` | `domain`, `event-bus`, `db`, `observability` |
| `agent-runtime` | `domain`, `event-bus`, `db`, `observability`, `sandbox` |
| `artifact-tracker` | `domain`, `event-bus`, `db`, `di`, `object-store`, `observability` |
| `verification-engine` | `domain`, `event-bus`, `db`, `di`, `observability`, `sandbox` |
| `attention-engine` | `domain`, `event-bus`, `db`, `di`, `object-store`, `observability` |
| `context-engine` | `domain`, `event-bus`, `db`, `di`, `embeddings`, `observability` |
| `review` | `domain`, `event-bus`, `db`, `di`, `observability` |
| `memory` | `domain`, `event-bus`, `db`, `di` |
| `judge` | `domain` |
| `benchmark` | `domain`, `db`, `judge` |
| `writeback` | `domain`, `mcp`, `git-provider`, `ticket-provider` |
| `evaluation` | `domain`, `db`, `di`, `observability` |

> **Note on `git-provider` / `ticket-provider`.** The older boundary text
> ("depends only on `@harness/domain`") predates the MCP re-scope. Today both also
> depend on `@harness/mcp`, because every GitHub/GitLab/Bitbucket/Jira tool goes
> through the single `mcp.config.json` fronting file — no per-tool REST channel.

---

## Every package — role, load-at-boot, dependency layer

| # | Package | Layer | Load at boot? | What it contributes at runtime |
| --- | --- | --- | --- | --- |
| 1 | `domain` | foundation | ✅ (types only) | Branded IDs, aggregates, event vocabulary, `TaskStatus`, `HumanDecisionType`, `AiProviderType` |
| 2 | `event-bus` | foundation | ✅ | `IEventBus` + in-process impl (+ optional `RedisEventsBus`) |
| 3 | `di` | foundation | ✅ | `Container`, `TOKENS`, `createRootLogger` (pino) |
| 4 | `db` | persistence | ✅ | Drizzle schema (49 tables), `createDb`, `EventLogWriter`, log/run stores |
| 5 | `observability` | telemetry | ✅ | OpenTelemetry tracing + Prometheus metrics (module-global singleton) |
| 6 | `auth` | engine | ✅ | OIDC identity + roles + `SessionService` (guards the review routes) |
| 7 | `orchestrator` | engine | ✅ | `TaskStateMachine` + `TaskService` (transition seam) |
| 8 | `agent-runtime` | engine | ✅ | `LLMProvider` seam (Anthropic / OpenAI-compatible / Mock) + `ReviewAgent` |
| 9 | `artifact-tracker` | engine | ✅ | `ArtifactTracker`, `SnapshotStore`, `ChangeStatusSubscriber`, `DiffEngine` |
| 10 | `verification-engine` | engine | ✅ | `CompileCheck` / `TestCheck` / `SandboxedCheck`, `EvidenceStore` |
| 11 | `attention-engine` | engine | ✅ | Scoring, routing, fatigue, auto-approve chain, learning loop |
| 12 | `context-engine` | engine | ✅ | collect → rank → trim → render context (keyword default) |
| 13 | `embeddings` | engine | ✅ | `Embedder` (stub default / OpenAI-compatible), indexer + re-embed listener |
| 14 | `evaluation` | engine | ✅ | `MetricsComputer` (offline gauges; not on the hot path) |
| 15 | `review` | review slice | ✅ | Review queue persistence + decision flow |
| 16 | `memory` | review slice | ✅ | Review-memory tiers + lifecycle (read wired; write not yet bound at boot) |
| 17 | `judge` | review slice | ✅ | Rubric-shadowed LLM-as-judge (pure measurement) |
| 18 | `writeback` | review slice | ✅ | `MCPWriteBack` — optional comment/status write-back (toggle-gated) |
| 19 | `git-provider` | review slice | ✅ | `GitProvider` (GitHub/GitLab/Bitbucket via MCP), clone + head-sha |
| 20 | `ticket-provider` | review slice | ✅ | `TicketProvider` (Jira via MCP) |
| 21 | `object-store` | leaf | ✅ | `ContentStore` (S3/MinIO or in-memory fallback) |
| 22 | `sandbox` | leaf | ✅ | `DockerSandbox` (Docker-isolated verification) |
| 23 | `mcp` | leaf | ✅ | Generic MCP client + `McpServerRegistry` (the one config file) |
| 24 | `code-index` | leaf | ❌ **CLI-only** | Dependency graph → targeted-test closure (verification demo) |
| 25 | `benchmark` | leaf | ❌ **CLI-only** | Versioned review-quality corpus + regression reports |

> "Load at boot?" = is its module imported anywhere under `apps/api/src/` (i.e. the
> server's module graph). Type-only imports (e.g. `domain`) still count as "loaded":
> they are resolved by the type-checker and pulled into the bundle, even if they
> contribute no runtime instance.

---

## The env-conditional loads

The graph *shape* is fixed; the *concrete instance* behind many tokens depends on
env. None of these prevent boot — an absent provider resolves to `null` or a stub.

| Token | When real | When absent |
| --- | --- | --- |
| `GitProvider` | `GitHubProvider(token)` when `GITHUB_TOKEN` set | `null` (ingest fails with a clear status) |
| `TicketProvider` | `JiraProvider(token, baseUrl)` when `JIRA_TOKEN`+`JIRA_BASE_URL` set | `null` |
| `LLMProvider` | `AnthropicProvider(key)` → else `OpenAICompatibleProvider` when `AI_BASE_URL` set → else `MockLLM` | `MockLLM` (fails loudly on use) |
| `Embedder` | `OpenAICompatibleEmbedder` when `EMBEDDINGS_BASE_URL` set | `StubEmbedder` (keyword path never reads it) |
| `ContentStore` | `ObjectStoreContentStore(S3/MinIO)` when `OBJECT_STORE_ENDPOINT` set | `InMemoryContentStore` (offload disabled, threshold `∞`) |
| `OidcProvider` | `OpenIdClientProvider` when `OIDC_ISSUER_URL`/client/secret set | `MockOidcProvider` |
| `Sandbox` check | `SandboxedCheck` when `VERIFY_SANDBOX_ENABLED=1` | in-process `CompileCheck` only |
| `EventBus` | `RedisEventsBus` when `EVENT_TRANSPORT=redis|sqs` (+ operator transport) | `InProcessEventBus` (`inproc`, default) |
| `McpServerRegistry` | parsed from `mcp.config.json` / `MCP_CONFIG_PATH` | empty registry (settings list empty) |
| `WriteBackService` | armed per `WRITEBACK_*` toggle | register `null`-safe, never writes externally |

---

## Why the app needs 25 packages

A "small" product (paste a PR URL, get a review) does **not** need a single big
codebase — it needs **many small, single-responsibility seams**. The count is
deliberate:

1. **Boundary rules, not files.** Each package is a compile-time wall. "Engines
   never import another engine" (R4) is only enforceable because `attention-engine`
   and `context-engine` are separate units with their own `package.json`, `tsconfig`,
   and lint boundary. Fold them into one folder and the rule evaporates.
2. **Built in layers.** The foundation (`domain`/`event-bus`/`db`/`di` + the
   engines) came first, then the cross-cutting seams were promoted to packages
   (`auth`, `embeddings`, `evaluation`, `object-store`, `observability`,
   `sandbox`), and finally the review slice (`git-provider`, `ticket-provider`,
   `memory`, `judge`, `writeback`, `mcp`, `benchmark`, `code-index`). Each was
   added as a seam because the seam *was* the delivery unit.
3. **Pure leaves for testability + safety.** `object-store`, `sandbox`, `mcp`,
   `code-index` import nothing internal on purpose — they can be unit-tested in
   isolation, and `sandbox`'s security property lives entirely in its own `docker
   run` flags (nothing else to lean on).
4. **Two of them are not even runtime.** `code-index` and `benchmark` exist for
   offline tooling, not the request path. They inflate the *package* count but cost
   the running app zero.

If you only count what the **server actually needs to answer a review**, the
runtime surface is the 23 in the table above — still modular, but one cohesive
control plane.

---

## Cross-references

- [`wiring-map.md`](wiring-map.md) — token-by-token DI object graph + the R1–R14 table.
- [architecture spec](HAI_Harness_Architecture_v0.6.md) — architecture, invariants, and exit criteria.
- [`../dev-guide.md`](../dev-guide.md) — clone-to-green in ~15 minutes.
- [`../runbook/README.md`](../runbook/README.md) — operating the running system.