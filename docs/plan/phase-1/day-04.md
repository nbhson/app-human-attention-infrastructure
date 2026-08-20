# Day 04 — PostgreSQL Schema & Migrations

| | |
|---|---|
| **Week** | 1 — Foundation |
| **Spec refs** | Spec 1 §7 (Data Model), Spec 5 §7 (Retention), Spec 2 §8 (Event Log) |
| **Estimated effort** | 7–8 hours |
| **Prerequisites** | Day 03 (event envelope, EventType constants) |

---

## 1. Objectives

By end of day you will have:

1. A running PostgreSQL 16 instance (Docker Compose, already scaffolded on Day 01).
2. A complete **Drizzle ORM schema** covering all Phase 1 tables.
3. A working **migration runner** that applies schema changes repeatably.
4. An **`EventLogWriter`** subscriber that persists every bus event to the `event_log` table.
5. Seed data sufficient to run integration tests against a real database from Day 05 onward.

---

## 2. Design Decisions

### 2.1 Why Drizzle ORM

- TypeScript-native — schema is plain TS, not a separate DDL file that drifts.
- Migrations are generated from the schema diff, not hand-written.
- Query builder produces SQL you can read and audit — important when debugging provenance queries.
- No decorator magic; entities stay plain interfaces from `packages/domain`.

### 2.2 Table Inventory (Phase 1)

| Table | Owning Package | Purpose |
|-------|---------------|---------|
| `projects` | `db` | Root entity; one per monitored codebase |
| `tasks` | `orchestrator` | Canonical task record + state machine fields |
| `agent_runs` | `agent-runtime` | One row per execution attempt |
| `artifacts` | `artifact-tracker` | Current version pointer for each tracked file |
| `changes` | `artifact-tracker` | Immutable record of every AI-produced change |
| `snapshots` | `artifact-tracker` | Content-addressed full-file snapshots |
| `contexts` | `context-engine` | Assembled context packages delivered to agents |
| `verification_requests` | `verification-engine` | What was asked to be checked |
| `verification_results` | `verification-engine` | What was actually found |
| `assessments` | `attention-engine` | Priority scores + labels |
| `decisions` | `review` | Human review decisions |
| `event_log` | `db` | Append-only audit log of every bus event |

**Phase 2+ tables** (embeddings, agent registry, calibration records) are intentionally absent. Do not create placeholder tables — add them when the Phase 2 spec demands them.

### 2.3 Key Column Decisions

| Column | Type | Reason |
|--------|------|--------|
| All primary keys | `text` (UUIDv7 string) | Branded IDs from domain; no serial ints leak into the domain layer |
| `state` / `status` enums | `text` + CHECK constraint | Keeps values in sync with const-object unions; readable in raw SQL |
| `occurred_at` / `created_at` | `timestamptz` | UTC always; no naive timestamps |
| `payload` / `metadata` | `jsonb` | Flexible schema for event payloads and extensible metadata |
| `content_hash` | `text` (SHA-256 hex) | Content-addressed dedup for snapshots (Spec 5 §7) |
| `correlation_id` | `text` (UUIDv7) | Indexed; powers all trace queries |

### 2.4 `event_log` Is Append-Only

```sql
-- No UPDATE, no DELETE. Ever.
-- Retention policy (Spec 5 §7): provenance metadata is never deleted.
-- Cold-storage archival is Phase 3; Phase 1 keeps everything in Postgres.
```

The `event_log` table is the source of truth for *what happened*. Every other table is a *current state projection*. If a projection table is ever lost or corrupted, it can be rebuilt by replaying `event_log`.

### 2.5 Migration Strategy

- Use `drizzle-kit generate` to produce migration SQL from schema diffs.
- Migration files live in `packages/db/migrations/` and are committed to git.
- The migration runner (`packages/db/src/migrate.ts`) is a plain Node script: `pnpm --filter @harness/db migrate`.
- Tests use a **separate schema** (`harness_test`) created and destroyed per test run — never run tests against the dev database.

---

## 3. Tasks

### 3.1 Scaffold `packages/db` (45 min)

- [x] `packages/db/package.json` — name `@harness/db`; deps: `drizzle-orm`, `postgres` (node-postgres driver), `@harness/domain`; devDeps: `drizzle-kit`.
- [x] `packages/db/tsconfig.json`.
- [x] `packages/db/drizzle.config.ts` — points to `src/schema/`, outputs to `migrations/`, reads `DATABASE_URL` from env.
- [x] `packages/db/src/index.ts` — barrel (empty for now).
- [x] Add `pnpm --filter @harness/db migrate` script to root `package.json`.

### 3.2 Define Drizzle schema — core tables (90 min)

Create one file per table group in `packages/db/src/schema/`:

- [x] `packages/db/src/schema/projects.ts`:

```typescript
export const projects = pgTable('projects', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  repo_path:   text('repo_path').notNull(),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [x] `packages/db/src/schema/tasks.ts` — all 12 canonical states as a CHECK constraint:

```typescript
export const tasks = pgTable('tasks', {
  id:               text('id').primaryKey(),
  project_id:       text('project_id').notNull().references(() => projects.id),
  title:            text('title').notNull(),
  description:      text('description'),
  state:            text('state', { enum: TASK_STATES }).notNull().default('PENDING'),
  attempt_number:   integer('attempt_number').notNull().default(0),
  assigned_agent:   text('assigned_agent'),
  idempotency_key:  text('idempotency_key').notNull().unique(), // task_id + attempt_number
  created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [x] `packages/db/src/schema/agent-runs.ts` — `id`, `task_id` FK, `attempt_number`, `status`, `started_at`, `finished_at`, `max_steps`, `steps_used`.
- [x] `packages/db/src/schema/index.ts` — barrel export of all schema objects.

### 3.3 Define Drizzle schema — artifact + verification tables (90 min)

- [x] `packages/db/src/schema/artifacts.ts` — `id`, `project_id` FK, `file_path`, `current_change_id`, `status` (enum includes `MERGED` per updated Spec 5 §2.1), `created_at`, `updated_at`.
- [x] `packages/db/src/schema/changes.ts` — `id`, `artifact_id` FK, `agent_run_id` FK, `change_type` (`CREATE`/`MODIFY`/`DELETE`), `status` (`PENDING`/`VERIFIED`/`REVIEWED`/`ROLLED_BACK`), `content_hash`, `diff_summary`, `commit_sha` (nullable — set after merge), `created_at`.
- [x] `packages/db/src/schema/snapshots.ts` — `id`, `change_id` FK, `content_hash` (indexed, for dedup), `content` (text), `generation` (integer), `created_at`.
- [x] `packages/db/src/schema/verification-requests.ts` — `id`, `task_id` FK, `change_id` FK, `requested_checks` (jsonb array), `timeout_ms`, `created_at`.
- [x] `packages/db/src/schema/verification-results.ts` — `id`, `request_id` FK, `status` (`PASSED`/`FAILED`/`FLAKY`/`TIMEOUT`/`ERROR`), `check_results` (jsonb), `execution_env`, `duration_ms`, `created_at`.

### 3.4 Define Drizzle schema — attention + review + event log (60 min)

- [x] `packages/db/src/schema/assessments.ts` — `id`, `artifact_id` FK, `change_id` FK, `risk_score`, `impact_score`, `novelty_score`, `complexity_score`, `confidence_score`, `combined_priority`, `label` (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`), `factors_unavailable` (jsonb — list of factors defaulted to 0.5), `created_at`.
- [x] `packages/db/src/schema/decisions.ts` — `id`, `change_id` FK, `assessment_id` FK, `decision` (`APPROVED`/`REJECTED`/`REWORK_REQUESTED`), `reviewer_id`, `rationale` (text, nullable), `created_at`.
- [x] `packages/db/src/schema/event-log.ts`:

```typescript
export const eventLog = pgTable('event_log', {
  event_id:       text('event_id').primaryKey(),
  event_type:     text('event_type').notNull(),
  event_version:  integer('event_version').notNull(),
  occurred_at:    timestamp('occurred_at', { withTimezone: true }).notNull(),
  correlation_id: text('correlation_id').notNull(),
  payload:        jsonb('payload').notNull(),
}, (t) => ({
  correlationIdx: index('event_log_correlation_idx').on(t.correlation_id),
  typeIdx:        index('event_log_type_idx').on(t.event_type),
  occurredAtIdx:  index('event_log_occurred_at_idx').on(t.occurred_at),
}));
```

- [x] Update `packages/db/src/schema/index.ts` barrel.

### 3.5 Generate and apply first migration (30 min)

- [x] Copy `.env.example` → `.env`; set `DATABASE_URL=postgres://harness:harness@localhost:5432/harness`.
- [x] `docker compose up -d postgres` — confirm healthy.
- [x] `pnpm --filter @harness/db generate` — review generated SQL before applying.
- [x] `pnpm --filter @harness/db migrate` — apply.
- [x] Verify with `psql`: `\dt` shows all 12 tables.

### 3.6 Implement `EventLogWriter` (60 min)

- [x] `packages/db/src/event-log-writer.ts`:

```typescript
export class EventLogWriter {
  constructor(private readonly db: DrizzleDB) {}

  async write<T>(event: EventEnvelope<T>): Promise<void> {
    await this.db.insert(eventLog).values({
      event_id:       event.event_id,
      event_type:     event.event_type,
      event_version:  event.event_version,
      occurred_at:    event.occurred_at,
      correlation_id: event.correlation_id,
      payload:        event.payload,
    }).onConflictDoNothing(); // idempotent: duplicate event_id is a no-op
  }

  subscribeTo(bus: IEventBus): void {
    // Subscribe to ALL event types — wildcard approach:
    for (const eventType of Object.values(EventType)) {
      bus.subscribe(eventType, (event) => this.write(event));
    }
  }
}
```

- [x] Handle the async `write` inside a sync handler: fire-and-forget with `.catch(err => console.error('[EventLogWriter] write failed', err))`. Phase 1 accepts this; Phase 2 adds a write queue.

### 3.7 Database client factory (30 min)

- [x] `packages/db/src/client.ts` — `createDb(connectionString: string): DrizzleDB`; throw if `DATABASE_URL` is not set.
- [x] `packages/db/src/index.ts` — export `createDb`, `EventLogWriter`, all schema objects, all inferred types (`typeof tasks.$inferSelect` etc.).

### 3.8 Seed script (45 min)

- [x] `packages/db/src/seed.ts` — insert:
  - 1 project (`fixtures/sample-repo` path)
  - 3 tasks in different states (`PENDING`, `EXECUTING`, `AWAITING_REVIEW`)
- [x] Add `pnpm --filter @harness/db seed` script.

### 3.9 Tests (90 min)

Use `harness_test` schema. Setup/teardown helpers in `packages/db/src/__tests__/helpers.ts`.

- [x] Migration applies cleanly to a fresh database.
- [x] `tasks.idempotency_key` unique constraint rejects duplicate inserts.
- [x] `event_log` insert + query by `correlation_id` returns correct rows.
- [x] `event_log` duplicate `event_id` insert is a silent no-op (idempotency test).
- [x] `EventLogWriter.write` persists an event; query returns matching `event_id`.
- [x] `changes.commit_sha` is nullable (Phase 1: most changes are pre-commit).
- [x] FK constraints reject orphaned inserts (e.g., `changes.artifact_id` pointing to nonexistent artifact).

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/*.ts` | All 12 Drizzle table definitions |
| `packages/db/migrations/0000_*.sql` | First generated migration |
| `packages/db/src/client.ts` | `createDb` factory |
| `packages/db/src/event-log-writer.ts` | `EventLogWriter` subscriber |
| `packages/db/src/seed.ts` | Dev seed data |
| `packages/db/src/__tests__/` | Full test suite |
| `packages/db/README.md` | Setup, migrate, seed instructions |

---

## 5. Acceptance Criteria

- [x] `docker compose up -d postgres` → healthy container.
- [x] `pnpm --filter @harness/db migrate` applies without errors.
- [x] `pnpm --filter @harness/db seed` inserts without errors.
- [x] `pnpm --filter @harness/db test` — all tests pass.
- [x] `pnpm --filter @harness/db build` — clean build.
- [x] `grep -r "from '@harness" packages/db/src` shows only `@harness/domain` and `@harness/event-bus` (for `IEventBus` type in `EventLogWriter`).
- [x] `event_log` table has indexes on `correlation_id`, `event_type`, `occurred_at`.
- [x] `tasks` table CHECK constraint enforces all 12 canonical states exactly as listed in Spec 2 §3.
- [x] `EventLogWriter` duplicate-write test passes (idempotency).

---

## 6. Notes & Pitfalls

- **Do not run `drizzle-kit push` in dev after the first migration.** `push` bypasses migration history. Always `generate` → review → `migrate`.
- **`timestamptz` everywhere.** Drizzle's `timestamp` without `withTimezone: true` produces `timestamp` (naive). This will silently corrupt UTC assumptions.
- **`jsonb` vs `json`:** always `jsonb`. It supports indexing and is faster to query.
- **The `tasks.state` CHECK constraint must list all 12 states explicitly.** Do not use a partial list "for now" — a missing state causes a silent DB-level rejection that is hard to trace.
- **`EventLogWriter` is intentionally fire-and-forget.** Making it synchronous would make every `publish` call block on a DB write. Accept the small risk of a lost log line in Phase 1; document it in the README.
- **`harness_test` schema isolation:** if tests are flaky, check that setup/teardown is dropping and recreating the schema, not just truncating tables — sequences and constraints can leak between runs.
- **`snapshots.content` can be large.** Phase 1 stores full file content in Postgres. If a file exceeds ~1MB, log a warning — do not silently truncate. Phase 3 adds cold-storage archival (Spec 5 §7).

---

*Prev: [Day 03 — Event Model & IEventBus](day-03.md) | Next: [Day 05 — Module Boundaries, DI & Dependency Enforcement](day-05.md)*
