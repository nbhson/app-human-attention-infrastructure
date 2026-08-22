# Developer Guide

> **Goal:** a clean machine + this guide → a passing `pnpm e2e` in under 15 minutes,
> with no tribal knowledge. If any step below stumbles, that is a *guide bug* — fix
> the guide, not your memory.

HAI Harness is a TypeScript monorepo (pnpm workspaces + Turborepo) that turns
AI-generated code into **verified, human-reviewed, evidence-backed changes**. An
Orchestrator moves tasks through a canonical state machine while dedicated engines
gather context, run agents, track artifacts, and verify results — every step
recorded in an append-only event log.

---

## 1. Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| Node.js | ≥ 20 | Engine runtime + `engines` field |
| pnpm | ≥ 9 | `packageManager` pins `9.15.4` |
| Docker | any recent | local PostgreSQL (+ pgvector), Prometheus, Grafana, MinIO — all via `docker compose` |

Nothing else. No global TypeScript, no Postgres client install, no service mesh.

## 2. Setup (clone-to-green)

```bash
git clone <repo-url> harness-human-attention-infrastructure
cd harness-human-attention-infrastructure

pnpm install             # links the @harness/* workspace packages
docker compose up -d     # starts postgres:16 (pgvector) + Prometheus + Grafana + MinIO

cp .env.example .env     # DATABASE_URL + placeholder ANTHROPIC_API_KEY

pnpm --filter @harness/db migrate   # apply migrations
pnpm seed:e2e-fixture     # idempotent REVIEWER principal the E2E needs (day-27)

pnpm test                # unit + integration, ~2 min
pnpm e2e                 # full vertical slice (happy + failure paths), <3 min
```

What each command actually does:

- `pnpm install` links the 11 `@harness/*` packages via workspace protocol, so
  importing `@harness/db` from another package resolves to `packages/db`, not npm.
- `docker compose up -d` runs the four services in `docker-compose.yml`: **Postgres**
  (the `pgvector/pgvector:pg16` image — vector column + plain SQL in one),
  **Prometheus** (scrapes the host-run API's `GET /metrics`), **Grafana**
  (provisioning-as-code dashboards from `infra/grafana`), and **MinIO**
  (S3-compatible object store for day-21 artifact offload). Postgres binds
  `localhost:5432` with user/password/db `harness`/`harness`/`harness` in the
  `pgdata` volume; MinIO is inert until `OBJECT_STORE_ENDPOINT` is set.
- `cp .env.example .env` — the `.env` is auto-loaded (best-effort) by
  `packages/db/src/env.ts`'s dotenv config; `migrate`/`seed` **throw** without a
  `DATABASE_URL`. Tests have a hard-coded fallback of the same local URL, but the
  scripts don't.
- `pnpm --filter @harness/db migrate` runs the Drizzle migrator against
  `packages/db/migrations/`.
- `pnpm seed:e2e-fixture` seeds the fixed `e2e-reviewer` principal
  (`onConflictDoNothing`, so re-runs are no-ops). The E2E driver re-seeds it too;
  this exists so the environment is ready *before* a driver run (day-27 §3.1).
- `pnpm test` runs Vitest across the workspace. Tests create and drop their own
  per-suite `harness_test_*` schemas, so they never touch your dev database.

> **Why there is no `pnpm db:migrate` / `pnpm db:reset` / `pnpm setup`:** those
> conveniences are still not wired (a carried backlog item). The canonical commands
> above are the source of truth; if they feel long, the fix is a `pnpm setup`
> meta-script (a tracked backlog item), not a longer guide.

## 3. Repository tour

| Path | Package | What it owns |
| --- | --- | --- |
| `packages/domain` | `@harness/domain` | Branded IDs, core types, `TaskStatus`, canonical event types |
| `packages/event-bus` | `@harness/event-bus` | `IEventBus` interface + `InProcessEventBus` (EventEmitter) |
| `packages/db` | `@harness/db` | Drizzle schema, migrations, `createDb`, `EventLogWriter`, `FaultyDb` test util |
| `packages/di` | `@harness/di` | `Container`, `TOKENS`, `Logger` (pino), architecture test |
| `packages/orchestrator` | `@harness/orchestrator` | `TaskStateMachine`, `TaskService`, `Dispatcher`/`DispatchLoop`, `WorkflowRunner`, retry taxonomy |
| `packages/agent-runtime` | `@harness/agent-runtime` | `ReActLoop`, `AgentRunner`, `RuntimePollLoop`, `LLMProvider`/`MockLLM`, tools, `TrajectoryRecorder` |
| `packages/artifact-tracker` | `@harness/artifact-tracker` | `ArtifactTracker`, `SnapshotStore`, `ChangeStatusSubscriber`, diff engine |
| `packages/verification-engine` | `@harness/verification-engine` | `CompileCheck`, `TestCheck`, evidence store, env sanitization |
| `packages/attention-engine` | `@harness/attention-engine` | Scoring (`PRIORITY_WEIGHTS`), `Router`, adaptive thresholds |
| `packages/context-engine` | `@harness/context-engine` | collect → rank → trim → persist, freshness check |
| `packages/review` | `@harness/review` | Review queue persistence + decision flow |
| `apps/api` | — | Fastify API (`bootstrap.ts`, routes, reconcile, e2e/load scripts) |
| `apps/web` | — | React + Vite review UI (minimal) |

### "Where do I change X?"

| You want to… | Look at |
| --- | --- |
| Change the task state machine | `2_Task_Work_Orchestrator_v0.3.md` §3 + `packages/orchestrator/src/state-machine/` |
| Change how changes are scored | `6_Attention_Engine_v0.2.md` §3 + `packages/attention-engine/src/scoring.ts` / `factors.ts` |
| Change context ranking | `4_Context_Engine_v0.3.md` §5 + `packages/context-engine/src/rank.ts` |
| Add a verification check | `7_Verification_Engine_v0.3.md` §4 + `packages/verification-engine/src/checks/` |
| Change review endpoints | `apps/api/src/routes/review.ts` + `packages/review/` |
| Change merge / rework flow | `apps/api/src/services/merge.ts`, `rework.ts` |
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
pnpm e2e                  # migrate + happy-path + failure-path scripts
pnpm load:smoke           # migrate + 50-task concurrency/load smoke
pnpm audit:orphans        # exit-code orphan alarm (see runbook R1)
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

## 5. Architecture rules (R1–R12)

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

**The rule you'll actually hit:** if you `import { X } from '@harness/db'` inside
`@harness/attention-engine`, `pnpm lint` fails with a `boundaries` error naming the
violated rule. Fix it by passing the dependency through the constructor (wired in
`apps/api/src/bootstrap.ts`), not by widening the rule.

**"Engines never import engines" in two sentences:** an engine's contract to its
neighbours is *events and data*, not method calls — so a change to the Agent
Runtime cannot silently alter the Attention Engine's behaviour. It keeps each
engine independently testable and replaceable, which is the whole point of the
modular monolith (Architecture spec §4.5, §18).

## 6. Testing philosophy

- **Real PostgreSQL for integration.** Tests spin up a real connection and an
  isolated `harness_test_<name>` schema per suite (created in `beforeAll`,
  dropped in `afterAll`). There is no SQLite/in-memory substitute — Drizzle
  semantics (`FOR UPDATE SKIP LOCKED`, `ON CONFLICT DO NOTHING`) only behave
  correctly against Postgres.
- **`MockLLM` for agent tests.** `@harness/agent-runtime` ships a scripted mock
  whose responses are keyed by `correlation_id` (== task id). Agent-loop tests
  never touch a real model, so they are fast and deterministic.
- **No mocks across package boundaries.** A package's tests use its real
  collaborators (or the container's real registrations). The only sanctioned
  substitute is `FaultyDb` (`@harness/db/test-utils`), a `Proxy` wrapping a real
  `DrizzleDB` to inject *queued* faults at the head of the next matching query.
- **Concurrency tests use barriers, not sleeps.** The C1–C7 suite and the load
  smoke coordinate with explicit promise/event barriers so assertions are
  race-free and deterministic; `await delay(...)` is a smell that hides a real
  race.

### The full gate

```sh
pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm e2e
```

This is what CI and every day's work must pass before a commit is pushed.

## 7. Phase-2 subsystems (env-gated)

The default run stays on the deterministic, no-external-service path. Each of
these Phase-2 subsystems is opt-in via an env var; flip it on only when you need
that behaviour.

**Object store (day-21).** Unset `OBJECT_STORE_ENDPOINT` keeps snapshot content
inline in Postgres (the Phase-1 default). Set it (MinIO is already up via compose)
to offload large (`> 1 MiB`) snapshots to S3, keyed by content hash:

```sh
OBJECT_STORE_ENDPOINT=http://localhost:9000 \
OBJECT_STORE_BUCKET=harness-artifacts \
OBJECT_STORE_ACCESS_KEY_ID=minioadmin \
OBJECT_STORE_SECRET_ACCESS_KEY=minioadmin \
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
VERIFY_SANDBOX_ENABLED=1 pnpm e2e
```

The parity holds by construction: `SandboxedCheck` runs `tsc --noEmit` inside the
`--network none` container, and `sandboxed-check.test.ts` asserts sandboxed and
in-process verdicts agree.

**Semantic shadow (day-18).** The keyword→dependency ranker is the served default
and stays so; the semantic retriever runs *alongside* it, writing a
`shadow_rank_comparisons` row never read by the hot path. It needs an embedding
index — populate it, and (for the E2E driver) opt the shadow in:

```sh
pnpm embed:populate          # batch/resumable index population over context_sources
SEMANTIC_SHADOW_ENABLED=1 pnpm e2e
```

A real embedder is optional: unset `EMBEDDINGS_BASE_URL` uses the deterministic
`StubEmbedder`; set it (plus `EMBEDDINGS_API_KEY`/`EMBEDDINGS_MODEL`) for
OpenAI-compatible embeddings.