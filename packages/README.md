# Packages — navigational index

25 `@harness/*` packages + 2 apps (`apps/api`, `apps/web`). This is a **map**,
not a physical folder layout: the packages live flat under `packages/` on
purpose (see *Why flat?* below). Grouping here is the **runtime layering** — who
may depend on whom — not build history.

> The authoritative relationship is the dependency graph, enforced by the
> boundary rules R1–R14 and asserted by
> `packages/di/src/__tests__/architecture.test.ts`. For "which package loads at
> start and how they depend on each other", read
> [`docs/architecture/runtime-startup.md`](../docs/architecture/runtime-startup.md);
> for the token-level object graph,
> [`docs/architecture/wiring-map.md`](../docs/architecture/wiring-map.md).

## The four layers

```text
apps/api ── apps/web          composition roots (import any @harness package)
     │            └── imports no @harness/* (HTTP-only client)
     ▼
review slice                  the product: ingest → AI review → decision → write-back
   git-provider  ticket-provider  writeback  memory  judge  benchmark
     ▼
engines                       read/write the foundation; never a sibling engine
   orchestrator  agent-runtime  artifact-tracker  verification-engine
   attention-engine  context-engine  review  auth  embeddings  evaluation
     ▼
foundation                    shared inward-only core; everything depends on these
   domain  event-bus  di  db  observability
     ▼
tooling                       import no @harness package (pure seams)
   object-store  sandbox  mcp  code-index*
```

`*` = CLI/out-of-band only (not loaded at API boot).
`benchmark` is likewise CLI-only; every other package loads at server boot.

## Foundation

| Package | One-line role |
| --- | --- |
| [`domain`](domain/README.md) | Branded IDs, aggregates, event vocabulary, `TaskStatus`, `HumanDecisionType`, `AiProviderType` |
| [`event-bus`](event-bus/README.md) | `IEventBus` + in-process impl (+ optional `RedisEventsBus`) |
| [`di`](di/README.md) | Hand-rolled `Container`, `TOKENS`, `createRootLogger` (pino) |
| [`db`](db/README.md) | Drizzle schema (49 tables), migrations, `createDb`, append-only `event_log` |
| [`observability`](observability/README.md) | OpenTelemetry tracing + Prometheus metrics (module-global singleton) |

## Engines

| Package | One-line role |
| --- | --- |
| [`orchestrator`](orchestrator/README.md) | `TaskStateMachine` + `TaskService` (dispatch/workflow/retry loop retired) |
| [`agent-runtime`](agent-runtime/README.md) | `LLMProvider` seam (Anthropic / OpenAI-compatible / Mock) + `ReviewAgent` |
| [`artifact-tracker`](artifact-tracker/README.md) | Snapshots, content-addressed store, `ChangeStatusSubscriber`, `DiffEngine` |
| [`verification-engine`](verification-engine/README.md) | `CompileCheck` / `TestCheck` / `SandboxedCheck` + `EvidenceStore` |
| [`attention-engine`](attention-engine/README.md) | Scoring, routing, fatigue, auto-approve chain, closed learning loop |
| [`context-engine`](context-engine/README.md) | Collect → rank → trim → render the context a reviewer sees |
| [`review`](review/README.md) | Review queue persistence + human decision flow |
| [`auth`](auth/README.md) | OIDC identity + roles + `SessionService` (guards the review routes) |
| [`embeddings`](embeddings/README.md) | `Embedder` (stub default / OpenAI-compatible), indexer + re-embed listener |
| [`evaluation`](evaluation/README.md) | Offline metric evaluator + the measured learning-loop calibration |

## Review slice

| Package | One-line role |
| --- | --- |
| [`git-provider`](git-provider/README.md) | `GitProvider` — GitHub/GitLab/Bitbucket via the MCP config; clone + head-sha |
| [`ticket-provider`](ticket-provider/README.md) | `TicketProvider` — Jira via the MCP config |
| [`writeback`](writeback/README.md) | `MCPWriteBack` — comment/status write-back (on by default, opt-out via `WRITEBACK_ENABLED=0` / `WRITEBACK_<PROVIDER>=0`) |
| [`memory`](memory/README.md) | Review-memory tiers + consolidation/decay/archive lifecycle |
| [`judge`](judge/README.md) | Rubric-scored LLM-as-judge (shadow measurement, never mutates a review) |
| [`benchmark`](benchmark/README.md) | Versioned review-quality corpus + regression reports (CLI-only) |

## Tooling

| Package | One-line role |
| --- | --- |
| [`object-store`](object-store/README.md) | `ContentStore` — S3/MinIO or in-memory fallback |
| [`sandbox`](sandbox/README.md) | `DockerSandbox` — Docker-isolated verification (no egress, non-root) |
| [`mcp`](mcp/README.md) | Generic MCP client + `McpServerRegistry` (the one `mcp.config.json` fronting file) |
| [`code-index`](code-index/README.md) | Dependency graph → targeted-test closure (CLI-only; drives verification) |

## The apps

| App | Role |
| --- | --- |
| `apps/api` | Fastify server — the composition root (`buildContainer` + `bootContainer`) |
| `apps/web` | React/Vite SPA — talks to the API over HTTP only |

## Why flat?

`packages/` is intentionally a **single flat directory**. Everything in the
toolchain — pnpm workspaces, Turborepo, eslint `boundaries`, CI's per-package
matrix, and every `import` in the codebase — resolves packages by **name**
(`@harness/*`), never by folder path. Moving packages into subfolders would
change the directory cosmetics but *nothing* about the dependency enforcement,
the build graph, or the runtime — while forcing every path-based reference
(`pnpm-workspace.yaml` globs, `vitest.config.ts` include glob, the ~25
`eslint.config.mjs` element patterns, each package's `vitest run … packages/<name>`
script, the CI matrix, and the doc links) to be rewritten for no functional gain.

The grouping you'd want from subfolders is exactly this page — the layering is
the *dependency DAG*, and it is already enforced structurally by R1–R14 and
already documented in `runtime-startup.md`.