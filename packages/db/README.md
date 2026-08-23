# @harness/db — Database Layer

PostgreSQL access for the whole system: the schema (41 tables), migrations,
seeding, and the data-access surface every package reads/writes through.

**Status:** Phase 1 + Phase 2 complete (as-built) ·
**Boundary rule:** imports only `@harness/domain` + `@harness/event-bus`; never an engine.

---

## Purpose

1. **Abstract PostgreSQL** behind Drizzle ORM (driver `postgres.js`).
2. **Hold the schema** — 41 tables, each owned by exactly one package's logic.
3. **Keep `event_log` append-only** — the source of truth for *what happened*.
4. **Expose data access** — `createDb`, `asReadonlyDb`, `AbStore`, `EventLogWriter`, audit helpers.

---

## The append-only model

One table — `event_log` — is **append-only** (no UPDATE/DELETE): it is the
source of truth for "*what actually happened*". Every other table is a
current-state snapshot that can be rebuilt by replaying `event_log`.

```text
                       ┌─────────────────────────────┐
                       │         event_log          │  append-only
                       │  (correlation_id, event_type, occurred_at)│
                       └─────────────────────────────┘
                                     │ replay
                                     ▼
                       ┌─────────────────────────────┐
                       │  tasks, changes, decisions … │  current-state
                       │  (rebuildable projections)  │  (mutable snapshots)
                       └─────────────────────────────┘
```

---

## Schema — 41 tables, grouped by owning domain

| Domain | Tables |
| --- | --- |
| **Orchestrator** | `projects`, `tasks`, `task-state-history`, ~~`task-step-log`~~, ~~`dispatch-log`~~, ~~`retry-log`~~ |
| **Agent runtime** | `llm-call-log`, ~~`agent-runs`~~, ~~`trajectory-steps`~~, ~~`code-mode-sessions`~~ |
| **Artifact tracker** | `artifacts`, `changes`, `snapshots` |
| **Context engine** | `contexts`, `context-source-cache`, `context-source-embeddings`, `shadow-rank-comparisons` |
| **Verification** | `verification-requests`, `verification-results`, `verification-check-results`, `verification-test-results`, `verification-reports` |
| **Attention** | `assessments`, `assessment-feedback`, `attention-thresholds`, `calibration`, `auto-approve-kill-switch` |
| **Review** | `review-queue`, `decisions`, `review-reports`, `review-findings`, `fix-suggestions` |
| **Integration (review slice)** | `provider-configs`, `writeback-log` |
| **Evidence / memory** | `evidence`, `event-log` |
| **Identity** | `users`, `sessions` |
| **Observability** | `trace-correlation` |
| **Evaluation** | `evaluation-reports`, `ab-harness` |

> **Struck-through tables are orphaned by `review-reorient`.** Their writers
> (`AgentRunner`, `TrajectoryRecorder`, the code-mode session writer, `Dispatcher`,
> `WorkflowRunner`) were retired with the code-generation path. The tables remain
> in the schema (no destructive drop migration) but are no longer written by any
> live code path; `llm-call-log` stays live via `LoggingLLMProvider`.

---

## Schema design rules

- **Primary key**: `text` (a UUIDv7 string from domain) — never `serial int`.
- **Status/type columns**: `text` + **CHECK constraint** (readable in raw SQL),
  enumerated in `schema/enums.ts` and kept in lockstep with `@harness/domain` by
  the drift test `enums.test.ts`.
- **Timestamps**: `timestamptz` (UTC). **JSON**: `jsonb`.
- **`event_log`**: append-only, indexed on `correlation_id`, `event_type`, `occurred_at`.

---

## Data-access surface

| Component | What it provides |
| --- | --- |
| `client.ts` | `createDb(connectionString)` → `DrizzleDB`. |
| `readonly-db.ts` | `asReadonlyDb` / `ReadonlyDb` — read-only view for consumers. |
| `event-log-writer.ts` | Subscribes every `EventType` to the bus and writes it to `event_log`; duplicate `event_id` is a no-op via `onConflictDoNothing()`. |
| `ab-store.ts` | `AbStore` — A/B experiment storage. |
| `audit-orphans.ts` | Orphaned-state audit queries. |
| `faults.ts` | Fault-injection helpers. |
| `migrate.ts` / `seed.ts` | Migration runner / dev seed. |

---

## Local setup

```bash
docker compose up -d postgres
cp .env.example .env                 # DATABASE_URL=postgres://harness:harness@localhost:5432/harness
pnpm --filter @harness/db generate   # generate migration from schema diff
pnpm --filter @harness/db migrate    # apply migrations
pnpm --filter @harness/db seed       # seed sample data
```

> **Do not use `drizzle-kit push`** after the first migration — always `generate` → review → `migrate`.

---

## Test strategy

- **Dedicated schemas** `harness_test` / `harness_test_writer` (`createTestDb()`
  creates the schema + `SET search_path` + migrates; `destroyTestDb()` drops via
  `DROP SCHEMA … CASCADE`). Tests never run on the dev DB.
- Migration SQL uses **unqualified** FK references so it applies via `search_path`.
- Tests run through `pnpm test` (root vitest), not `pnpm --filter @harness/db test`.

---

## Directory structure

```
src/
├── index.ts            # schema barrel + createDb + EventLogWriter
├── client.ts           # createDb
├── readonly-db.ts      # asReadonlyDb / ReadonlyDb
├── event-log-writer.ts
├── ab-store.ts
├── audit-orphans.ts
├── faults.ts
├── env.ts / migrate.ts / seed.ts / test-utils.ts
└── schema/
    ├── enums.ts        # CHECK constraints + value lists
    ├── index.ts        # relational schema registry
    └── *.ts            # 41 table definitions
```

## Public API surface

```typescript
// createDb, DrizzleDB, asReadonlyDb / ReadonlyDb, EventLogWriter, AbStore,
// schema tables (41), enums (CHECK constraints), migration/seed helpers
```

## Dependency rule

```
packages/db → imports only @harness/domain + @harness/event-bus (for IEventBus)
            → does NOT import other engine packages
```

Schema files do **not** import `@harness/domain` at runtime (so `drizzle-kit
generate` never pulls an ESM workspace package); all status values live in
`schema/enums.ts` and are drift-tested against domain.