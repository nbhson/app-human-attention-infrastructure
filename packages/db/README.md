# @harness/db — Database Layer

PostgreSQL access for the whole system: the schema (49 tables), migrations,
seeding, and the data-access surface every package reads/writes through.

**Status:** v1.0-candidate (Phase 3 as-built) — pending Day 40 exit review ·
**Boundary rule:** imports only `@harness/domain` + `@harness/event-bus`; never an engine.

---

## Purpose

1. **Abstract PostgreSQL** behind Drizzle ORM (driver `postgres.js`).
2. **Hold the schema** — 49 tables, each owned by exactly one package's logic.
3. **Keep `event_log` append-only** — the source of truth for *what happened*.
4. **Expose data access** — `createDb`, `asReadonlyDb`, `AbStore`, `EventLogWriter`,
   audit helpers, and the Phase-3 log/run stores (`WritebackLogStore`,
   `JudgeRunStore`, `JudgeAgreementStore`).

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

## Schema — 49 tables, grouped by owning domain

| Domain | Tables |
| --- | --- |
| **Orchestrator** | `projects`, `tasks`, `task_state_history`, `retry_log` ◌ |
| **Agent runtime** | `llm_call_log`, `agent_runs` ◌, `trajectory_steps` ◌ |
| **Artifact tracker** | `artifacts`, `changes`, `snapshots` |
| **Context engine** | `contexts`, `source_usefulness`, `context_source_cache`, `context_source_embeddings`, `shadow_rank_comparisons` |
| **Verification** | `verification_requests`, `verification_results`, `verification_check_results`, `verification_test_results`, `verification_reports` |
| **Attention** | `assessments`, `assessment_feedback`, `attention_thresholds`, `calibration_datasets`, `calibration_weights`, `calibration_rows`, `auto_approve_kill_switch` |
| **Review** | `review_queue`, `decisions`, `review_decisions`, `review_reports`, `review_findings`, `fix_suggestions` |
| **Integration (writeback)** | `provider_configs`, `writeback_log` |
| **Evidence** | `evidence`, `evidence_links` |
| **Event log** | `event_log` |
| **Memory** | `memory_entries`, `memory_entry_evidence` |
| **Judge** | `judge_runs`, `judge_agreements` |
| **Benchmark** | `review_examples` |
| **Identity** | `users`, `sessions` |
| **Observability** | `trace_correlation` |
| **Evaluation (A/B)** | `evaluation_reports`, `ab_experiments`, `ab_runs` |

> **◌ Orphaned by `review-reorient`.** Their writers (`AgentRunner`,
> `TrajectoryRecorder`, the retry loop) were retired with the code-generation
> path. Three tables still remain in the schema but are no longer written by any
> live code path: `retry_log`, `agent_runs`, `trajectory_steps`. Five more
> (`task_step_log`, `dispatch_log`, `code_mode_sessions`, `code_index_symbols`,
> `code_index_deps`) were dropped in migration 0042 (`6e8d294`). `llm_call_log`
> stays live via `LoggingLLMProvider`.
>
> **Phase-3 additions.** `memory_entries` / `memory_entry_evidence` (review-memory
> tiers), `judge_runs` / `judge_agreements` (rubric shadow judging), `review_examples`
> (gold-labelled benchmark corpus), `source_usefulness` (learned-usage ranking
> signal), and `review_decisions` (human verdict on the AI report, carrying the
> effective `writeback_enabled` flag at decision time).

---

## Schema design rules

- **Primary key**: `text` (a UUIDv7 string from domain) — never `serial int`.
- **Status/type columns**: `text` + **CHECK constraint** (readable in raw SQL),
  enumerated in `schema/enums.ts` and kept in lockstep with `@harness/domain` by
  the drift test `enums.test.ts`.
- **Timestamps**: `timestamptz` (UTC). **JSON**: `jsonb`.
- **`event_log`**: append-only, indexed on `correlation_id`, `event_type`, `occurred_at`.
- **Vector columns** (`context_source_embeddings`) live behind the pgvector
  extension image; CI provisions the extension so the schema stays portable.

---

## Data-access surface

| Component | What it provides |
| --- | --- |
| `client.ts` | `createDb(connectionString)` → `DrizzleDB`. |
| `readonly-db.ts` | `asReadonlyDb` / `ReadonlyDb` — read-only view for consumers. |
| `event-log-writer.ts` | Subscribes every `EventType` to the bus and writes it to `event_log`; duplicate `event_id` is a no-op via `onConflictDoNothing()`. |
| `ab-store.ts` | `AbStore` — A/B experiment storage. |
| `writeback-log-store.ts` | `WritebackLogStore` — `writeback_log` read/update for the write-back audit surface. |
| `judge-run-store.ts` | `JudgeRunStore` — persist/read `judge_runs`. |
| `judge-agreement-store.ts` | `JudgeAgreementStore` — persist/read `judge_agreements`. |
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
├── ab-store.ts / writeback-log-store.ts / judge-run-store.ts / judge-agreement-store.ts
├── audit-orphans.ts
├── faults.ts
├── env.ts / migrate.ts / seed.ts / test-utils.ts
└── schema/
    ├── enums.ts        # CHECK constraints + value lists
    ├── index.ts        # relational schema registry
    └── *.ts            # 49 table definitions across 41 files
```

## Public API surface

```typescript
// createDb, DrizzleDB, asReadonlyDb / ReadonlyDb, EventLogWriter, AbStore,
// WritebackLogStore, JudgeRunStore, JudgeAgreementStore,
// schema tables (49), enums (CHECK constraints), migration/seed helpers
```

## Dependency rule

```
packages/db → imports only @harness/domain + @harness/event-bus (for IEventBus)
            → does NOT import other engine packages
```

Schema files do **not** import `@harness/domain` at runtime (so `drizzle-kit
generate` never pulls an ESM workspace package); all status values live in
`schema/enums.ts` and are drift-tested against domain.