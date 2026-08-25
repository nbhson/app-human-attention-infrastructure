# Developer Guide

> **Goal:** a clean machine + this guide → a green `pnpm test` in under 15 minutes,
> with no tribal knowledge. If any step below stumbles, that is a *guide bug* — fix
> the guide, not your memory.

HAI Harness is a TypeScript monorepo (pnpm workspaces + Turborepo) that turns a
pasted PR / MR URL (+ an optional Jira ticket) into a **stored AI review** — a
report with findings and fix suggestions — ready for a human decision. A task
state machine, attention routing, independent verification, and an append-only
event log back the loop; the code-generation path (AI writes + commits code) is
retired.

---

## 1. Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| Node.js | ≥ 20 | Engine runtime + `engines` field |
| pnpm | ≥ 9 | `packageManager` pins `9.15.4` |
| Docker | any recent | local PostgreSQL (+ pgvector) via `docker compose` |

Nothing else. No global TypeScript, no Postgres client install, no service mesh.

## 2. Setup (clone-to-green)

```bash
git clone <repo-url> harness-human-attention-infrastructure
cd harness-human-attention-infrastructure

pnpm install             # links the @harness/* workspace packages
docker compose up -d     # starts postgres:16 (pgvector) — the only docker service

cp .env.example .env     # DATABASE_URL + placeholder provider keys

# optional — connect real Git/Jira tools over MCP (git-ignored; never commit it):
cp mcp.config.example.json mcp.config.json   # tokenEnv references, no secrets

pnpm --filter @harness/db migrate   # apply migrations

pnpm test                # unit + integration, ~2 min
pnpm dev                 # run the API + web UI
```

What each command actually does:

- `pnpm install` links the 25 `@harness/*` packages via workspace protocol, so
  importing `@harness/db` from another package resolves to `packages/db`, not npm.
- `docker compose up -d` runs the one service in `docker-compose.yml`: **Postgres**
  (the `pgvector/pgvector:pg16` image — vector column + plain SQL in one), bound to
  `localhost:5432` with user/password/db `harness`/`harness`/`harness` in the
  `pgdata` volume. No Prometheus, Grafana, or MinIO is bundled: the metrics are
  served in Prometheus text format at `GET /metrics` for your own scraper, and the
  object store needs your own S3-compatible endpoint (see §7).
- `cp .env.example .env` — the `.env` is auto-loaded (best-effort) by
  `packages/db/src/env.ts`'s dotenv config; `migrate`/`seed` **throw** without a
  `DATABASE_URL`. Tests have a hard-coded fallback of the same local URL, but the
  scripts don't.
- `cp mcp.config.example.json mcp.config.json` is **optional** — without it the
  API boots fine and the providers resolve to `null` (the REST path for
  GitHub/Jira, via `GITHUB_TOKEN`/`JIRA_TOKEN`). With it, GitHub/GitLab/Bitbucket/
  Jira all connect through the MCP layer driven by one file; each entry's
  `tokenEnv` is a *reference to* an env var, never a secret (the value is reduced
  to a last-4 `tokenHint` at load). Resolved from `MCP_CONFIG_PATH` (default
  `./mcp.config.json`).
- `pnpm --filter @harness/db migrate` runs the Drizzle migrator against
  `packages/db/migrations/`.
- `pnpm test` runs Vitest across the workspace. Tests create and drop their own
  per-suite `harness_test_*` schemas, so they never touch your dev database.

> **Why there is no `pnpm db:migrate` / `pnpm db:reset` / `pnpm setup`:** those
> conveniences are still not wired (a carried backlog item). The canonical commands
> above are the source of truth; if they feel long, the fix is a `pnpm setup`
> meta-script (a tracked backlog item), not a longer guide.

## 3. Repository tour

| Path | Package | What it owns |
| --- | --- | --- |
| `packages/domain` | `@harness/domain` | Branded IDs, core types, `TaskStatus`, canonical event types (incl. `learning.*`, `memory.*`, `writeback.*`) |
| `packages/event-bus` | `@harness/event-bus` | `IEventBus` + `InProcessEventBus` (default), `RedisEventsBus` (durable), `transport-resolver` (`EVENT_TRANSPORT`) |
| `packages/db` | `@harness/db` | Drizzle schema (49 tables), migrations, `createDb`, `EventLogWriter`, `WritebackLogStore`/`JudgeRunStore`/`JudgeAgreementStore`, `FaultyDb` |
| `packages/di` | `@harness/di` | `Container`, `TOKENS`, `Logger` (pino), architecture test |
| `packages/orchestrator` | `@harness/orchestrator` | `TaskStateMachine`, `TaskService` (the dispatch/workflow/retry loop was retired) |
| `packages/agent-runtime` | `@harness/agent-runtime` | `LLMProvider` (Anthropic + OpenAI-compatible), `MockLLM`, `ReviewAgent` (the ReAct write path was retired) |
| `packages/artifact-tracker` | `@harness/artifact-tracker` | `ArtifactTracker`, `SnapshotStore`, `ChangeStatusSubscriber`, diff engine |
| `packages/verification-engine` | `@harness/verification-engine` | `CompileCheck`/`TestCheck`/`SandboxedCheck`, `CloneVerifier`, `TargetedVerifier`, evidence store, env sanitization |
| `packages/attention-engine` | `@harness/attention-engine` | Scoring (`PRIORITY_WEIGHTS`), `Router`, adaptive thresholds, `learning/*` closed loop (`LearningLoop`, `decidePromotion`) |
| `packages/context-engine` | `@harness/context-engine` | collect → rank → trim → render, freshness, `RetrieverFactory` (`rank_method`), memory resolver |
| `packages/review` | `@harness/review` | Review queue persistence + decision flow |
| `packages/git-provider` | `@harness/git-provider` | `GitProvider` seam + `GitHubProvider` (REST) + `MCPGitProvider`/`GitToolMap` (multi-host); `clone`/`head-sha` |
| `packages/ticket-provider` | `@harness/ticket-provider` | `TicketProvider` seam + `JiraProvider` (REST) + `MCPTicketProvider`/`TicketToolMap` |
| `packages/mcp` | `@harness/mcp` | `McpServerRegistry`/`McpServerRegistryImpl`, `MCPGitProvider`/`MCPTicketProvider`/`MCPWriteBack`, config loader |
| `packages/writeback` | `@harness/writeback` | `WriteBackService`/`MCPWriteBack`, `WritebackAction`, dedup + redact, 3-layer toggle |
| `packages/memory` | `@harness/memory` | `MemoryStore`/`MemoryDistiller`/`MemoryRetriever`/`MemoryLifecycle` (REVIEW/FINDING/DECISION/PROJECT tiers) |
| `packages/code-index` | `@harness/code-index` | hand-rolled lexical scanner → dependency graph → `affectedTests` (no tree-sitter needed) |
| `packages/judge` | `@harness/judge` | `Judge` (rubric v1), `JudgeShadow`, `AgreementReport` |
| `packages/benchmark` | `@harness/benchmark` | `review_examples` gold corpus + `evaluateJudge` (read-only evaluator) |
| `packages/auth` | `@harness/auth` | `requireRole`, session/OIDC identity |
| `packages/evaluation` | `@harness/evaluation` | `eval:*` jobs, metrics, A/B report generator |
| `packages/embeddings` | `@harness/embeddings` | `Embedder` seam (`StubEmbedder` default), `EmbeddingIndexer` |
| `packages/object-store` | `@harness/object-store` | `ContentStore` seam (S3/MinIO vs in-memory fallback) |
| `packages/sandbox` | `@harness/sandbox` | Docker sandbox execution (pinned image) |
| `packages/observability` | `@harness/observability` | pino logging + OTel tracing/monitoring |
| `apps/api` | — | Fastify API (`bootstrap.ts`, routes, the review slice in `services/review-ingest.ts`) |
| `apps/web` | — | React + Vite review UI (minimal) |

### "Where do I change X?"

| You want to… | Look at |
| --- | --- |
| Change the task state machine | `packages/orchestrator/README.md` + `packages/orchestrator/src/state-machine/` |
| Change how changes are scored | `packages/attention-engine/README.md` + `packages/attention-engine/src/scoring.ts` / `factors.ts` |
| Change context ranking | `packages/context-engine/README.md` + `packages/context-engine/src/rank.ts` + `retrieval/retriever-factory.ts` |
| Add/rename a ranking method | `packages/context-engine/src/retrieval/retriever-factory.ts` (`rank_method`) |
| Add a verification check | `packages/verification-engine/README.md` + `packages/verification-engine/src/checks/` |
| Add a clone/targeted check | `packages/verification-engine/src/clone-checks/` + `targeted-verifier.ts` |
| Change review endpoints | `apps/api/src/routes/review.ts` + `packages/review/` |
| Change the review-slice ingest flow | `apps/api/src/services/review-ingest.ts` + `apps/api/src/routes/reviews.ts` |
| Change write-back behaviour | `packages/writeback/src/writeback-service.ts` + `apps/api/src/writeback-gate.ts` |
| Change review memory | `packages/memory/src/memory-store.ts` / `memory-distiller.ts` / `lifecycle/` |
| Change the dependency graph / affected tests | `packages/code-index/src/graph.ts` / `affected.ts` (hand-rolled lexical — no tree-sitter) |
| Change the judge rubric | `packages/judge/src/rubric.ts` + `judge.ts` |
| Change the benchmark corpus | `packages/benchmark/src/corpus.ts` + `evaluateJudge` |
| Add an MCP-connected host | `mcp.config.json` (one file, per-host entry) + `packages/git-provider/src/git-tool-map.ts` |
| Add a DB table/column | `packages/db/src/schema/` + a new migration |
| Add a domain event | `packages/domain/src/events/event-types.ts` |
| Add/rename a container token | `packages/di/src/tokens.ts` + `apps/api/src/bootstrap.ts` |

## 4. Daily workflow

```sh
pnpm dev                  # turbo run dev — runs apps/api via tsx watch
pnpm test                 # full suite (unit + integration)
pnpm test -- packages/orchestrator   # run one package's tests only
pnpm lint                 # eslint across the repo (boundaries enforced here)
pnpm typecheck            # turbo run typecheck (tsc --noEmit everywhere)
pnpm build                # turbo run build (each package emits dist)
pnpm e2e                  # full-system e2e over the real stack (see below)
pnpm audit:orphans        # exit-code orphan alarm (see runbook R1)
```

**`pnpm e2e`** runs the end-to-end suites in `e2e/` (config
`e2e/vitest.config.ts`) against a live Postgres. It expects a seeded fixture:

```sh
pnpm seed:e2e-fixture     # one-time; then run e2e repeatedly
pnpm e2e
```

**Adding a migration:** edit the schema in `packages/db/src/schema/`, then
`pnpm --filter @harness/db generate` (drizzle-kit emits `NNNN_<slug>.sql` into
`packages/db/migrations/`), then `pnpm --filter @harness/db migrate`. **Never edit
an applied migration** — append a new one; people's databases are already past it.

**Full reset (dev only):**

```sh
docker compose down -v && docker compose up -d && pnpm --filter @harness/db migrate
```

`down -v` destroys the `pgdata` volume. This is destructive and has no guard — it
is for throwaway dev environments only (runbook R7).

## 5. Architecture rules (R1–R14)

Dependency direction points inward; the domain never imports infrastructure. The
rules are enforced by `eslint-plugin-boundaries` at lint time and asserted by
`packages/di/src/__tests__/architecture.test.ts`:

| Rule | Constraint |
| --- | --- |
| R1 | `@harness/domain` imports nothing (internal) |
| R2 | `@harness/event-bus` → `domain` only |
| R3 | `@harness/db` → `domain`, `event-bus` only |
| R4 | engines (`orchestrator`, `agent-runtime`, etc.) → `domain`, `event-bus`, `db`, `di` only |
| R5 | `apps/*` → anything |
| R6 | `@harness/review` → `domain`, `event-bus`, `db`, `di` only |
| R7 | `@harness/auth` → `domain`, `db`, `event-bus`, `di` only (never an engine) |
| R8 | `@harness/observability` → `domain`, `db`, `di` only; every telemetry-carrying engine depends on it |
| R9 | `@harness/evaluation` → `domain`, `db`, `di`, `observability` only (never an engine) |
| R10 | `@harness/embeddings` → `domain`, `db`, `event-bus` only (never `di`/`observability`/an engine) |
| R11 | `@harness/object-store` → no `@harness/*` dependency (leaf seam) |
| R12 | `@harness/sandbox` → no `@harness/*` dependency (leaf seam) |
| R13 | `@harness/git-provider` → `domain` only (never an engine) |
| R14 | `@harness/ticket-provider` → `domain` only (never an engine) |

**The rule you'll actually hit:** if you `import { X } from '@harness/db'` inside
`@harness/attention-engine`, `pnpm lint` fails with a `boundaries` error naming the
violated rule. Fix it by passing the dependency through the constructor (wired in
`apps/api/src/bootstrap.ts`), not by widening the rule.

**"Engines never import engines" in two sentences:** an engine's contract to its
neighbours is *events and data*, not method calls — so a change to the Agent
Runtime cannot silently alter the Attention Engine's behaviour. It keeps each
engine independently testable and replaceable, which is the whole point of the
modular monolith (Architecture spec §7, cross-cutting invariants).

## 6. Testing philosophy

- **Real PostgreSQL for integration.** Tests spin up a real connection and an
  isolated `harness_test_<name>` schema per suite (created in `beforeAll`,
  dropped in `afterAll`). There is no SQLite/in-memory substitute — Drizzle
  semantics (`FOR UPDATE SKIP LOCKED`, `ON CONFLICT DO NOTHING`) only behave
  correctly against Postgres.
- **`MockLLM` for review-agent tests.** `@harness/agent-runtime` ships a scripted mock
  whose responses are keyed by `correlation_id` (== task id). Review-agent tests
  never touch a real model, so they are fast and deterministic.
- **No mocks across package boundaries.** A package's tests use its real
  collaborators (or the container's real registrations). The only sanctioned
  substitute is `FaultyDb` (`@harness/db/test-utils`), a `Proxy` wrapping a real
  `DrizzleDB` to inject *queued* faults at the head of the next matching query.
- **Concurrency tests use barriers, not sleeps.** Concurrency suites coordinate
  with explicit promise/event barriers so assertions are race-free and
  deterministic; `await delay(...)` is a smell that hides a real race.

### The full gate

```sh
pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm e2e
```

`pnpm e2e` is the outermost gate (needs a seeded fixture, see §4); the first four
(`lint`, `typecheck`, `build`, `test`) are the CI-critical core every commit must
pass. This is what CI and every day's work must pass before a commit is pushed.

## 7. Opt-in subsystems (env-gated)

The default run stays on the deterministic, no-external-service path. Each of
these subsystems is opt-in via an env var; flip it on only when you need
that behaviour.

**Object store (day-21).** Unset `OBJECT_STORE_ENDPOINT` keeps snapshot content
inline in Postgres (the default). Set it to a S3-compatible endpoint — the repo
provisions none, so point it at your own S3/MinIO — to offload large (`> 1 MiB`)
snapshots, keyed by content hash:

```sh
OBJECT_STORE_ENDPOINT=https://s3.example.com \
OBJECT_STORE_BUCKET=harness-artifacts \
OBJECT_STORE_ACCESS_KEY_ID=... \
OBJECT_STORE_SECRET_ACCESS_KEY=... \
OBJECT_STORE_THRESHOLD_BYTES=1048576 \
pnpm dev
```

The `ContentStore` seam resolves to `ObjectStoreContentStore(AwsS3ClientPort)` in
that case, else the ephemeral `InMemoryContentStore` dev fallback (wiring-map
`ContentStore` row). On a read-back integrity failure the `DiffEngine` records
`harness_object_store_integrity_error_total` before rethrow — never a silent
return.

**Container sandbox (day-22).** Verification runs the in-process COMPILE parity
path by default. To force the container path, build the pinned image once and set
the flag (an image that isn't built degrades back to in-process, not to a false
`FAILED`):

```sh
docker build -t harness-verify:node20 packages/sandbox
VERIFY_SANDBOX_ENABLED=1 pnpm dev
```

The parity holds by construction: `SandboxedCheck` runs `tsc --noEmit` inside the
`--network none` container, and `sandboxed-check.test.ts` asserts sandboxed and
in-process verdicts agree.

**Semantic shadow (day-18).** The keyword→dependency ranker is the served default
and stays so; the semantic retriever runs *alongside* it, writing a
`shadow_rank_comparisons` row never read by the hot path. It needs an embedding
index — populate it to opt the shadow in:

```sh
pnpm embed:populate          # batch/resumable index population over context_sources
SEMANTIC_SHADOW_ENABLED=1 pnpm dev
```

A real embedder is optional: unset `EMBEDDINGS_BASE_URL` uses the deterministic
`StubEmbedder`; set it (plus `EMBEDDINGS_API_KEY`/`EMBEDDINGS_MODEL`) for
OpenAI-compatible embeddings.

## 8. Configuration stack (env + MCP)

The configuration surface is **configuration-first**: external systems connect
through **one `mcp.config.json`**, write-back is behind a fail-safe toggle, and the
AI provider is swappable. All of it is env-gated; the default run stays local and
deterministic.

**MCP connectivity (day-02).** `mcp.config.json` is the single connectivity file:
each `servers` entry names a transport (`stdio` command + args, or an `sse` url)
and a `tokenEnv` *reference* (never a secret). At load the token's presence is
checked and reduced to a non-reversible last-4 `tokenHint`, then discarded; the
real token lives only in the MCP server's environment and is injected at connect
time. Resolve path: `MCP_CONFIG_PATH` (default `./mcp.config.json`).

```sh
MCP_CONFIG_PATH=./mcp.config.json pnpm dev
```

**AI provider (any provider, not just Anthropic).** Unset `AI_BASE_URL` → the
Anthropic path (`ANTHROPIC_API_KEY`, model `ANTHROPIC_MODEL` default
`claude-sonnet-4-6`). Set `AI_BASE_URL` to an OpenAI-compatible endpoint to switch
to "any provider" (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` default `gpt-4.1`):

```sh
AI_BASE_URL=https://api.openai.com/v1 \
AI_PROVIDER=openai \
AI_API_KEY=... \
AI_MODEL=gpt-4.1 \
pnpm dev
```

**Write-back toggles (day-09) — fail-safe, three layers.** An external write fires
only when *every* layer is armed: (1) the global ceiling `WRITEBACK_ENABLED=1`,
(2) the per-provider flag (`WRITEBACK_GITHUB`/`WRITEBACK_GITLAB`/
`WRITEBACK_BITBUCKET`/`WRITEBACK_JIRA`), and (3) a `writeback: true` request flag
on the decision. Unset/at-rest ⇒ nothing external is written; `provider_configs`
holds only a `token_redacted` hint, never a token. (See runbook
[operations.md](runbook/operations.md) OP-1/OP-2.)

```sh
WRITEBACK_ENABLED=1 WRITEBACK_GITHUB=1 pnpm dev
```

**Durable queue (day-34).** `EVENT_TRANSPORT=inproc|redis|sqs` selects the event
bus; the default is the zero-config in-process bus. `redis`/`sqs` require the
operator to supply a `StreamTransport` adapter (the repo ships none — live brokers
are opt-in); an unknown value throws at startup rather than silently degrading.

```sh
EVENT_TRANSPORT=redis pnpm dev   # throws without a wired StreamTransport adapter
```

**Sandbox + object store + embeddings** carry over from §7 (`VERIFY_SANDBOX_*`,
`OBJECT_STORE_*`, `EMBEDDINGS_*`). **No tree-sitter install is required** — the
`@harness/code-index` dependency graph is a hand-rolled lexical scanner over
Node-builtins, so the dependency toolchain above (§1) is complete.