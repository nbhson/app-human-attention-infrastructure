# Day 04 — PostgreSQL schema + migrations (incl. review tables)

| | |
|---|---|
| **Week** | W1 — Foundation |
| **Spec refs** | Spec 1 §7 (append-only event log), Spec 9 §1 (evidence/memory) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 03 (events carry `correlation_id`) |

---

## 1. Objectives

- Stand up `@harness/db` on PostgreSQL 16 + Drizzle ORM with a migration pipeline (`drizzle-kit`).
- Model the core tables the review loop needs: `tasks`, `task_state_history`, `review_reports`, `review_findings`, `fix_suggestions`, and the append-only `event_log`.
- Introduce the enum tables/columns (`taskStatus`, `humanDecisionTypes`, `reviewSeverity`, `reviewVerdict`) mirroring the domain unions exactly.
- Provide a typed data-access layer and a `dockertest`/fixture-based way to run migrations against a throwaway database.

## 2. Design Decisions

- **Append-only `event_log` is the source of truth**: every state change, LLM call, and decision lands there joined by `correlation_id`; the other tables are current-state projections rebuildable by replay.
- `review_findings` and `fix_suggestions` are children of `review_reports` (FK), with `order_index` for stable suggestion ordering; `review_reports` store `pr_url`, `ai_provider`, `model`, `summary`, and `overall_verdict`.

```sql
-- shape (per Drizzle schema), not raw SQL
review_reports  (id uuid pk, pr_url text, pr_title text, ai_provider text,
                 model text, summary text, overall_verdict text, created_at timestamptz)
review_findings (id uuid pk, report_id uuid fk, severity text, file text,
                 line int, message text, suggestion text)
fix_suggestions(id uuid pk, report_id uuid fk, file text, hunk text,
                proposed text, rationale text, order_index int)
event_log      (id uuid pk, event_type text, correlation_id text,
                payload jsonb, occurred_at timestamptz)
```

- Migrations are versioned and forward-only; seeds use fixtures, never a production dataset. No code-generation tables (`agent_runs` for tool exec, merge/rework) are authored — the review slice is the only lifecycle.

## 3. Tasks

### 3.1 Schema (120 min)
- [ ] `packages/db/src/schema/*.ts` — tasks, history, review tables, event log, enums
- [ ] `packages/db/src/client.ts` — pg pool + Drizzle client

### 3.2 Migrations (90 min)
- [ ] `drizzle-kit` config + first migration generation
- [ ] `packages/db/src/migrate.ts` — apply-migrations runner for bootstrap

### 3.3 Data access + tests (150 min)
- [ ] Repositories: insert/find review report with findings + suggestions; append event log row
- [ ] Integration tests spin up a test DB, migrate, insert, and assert round-trip

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/index.ts` | Drizzle schema (tasks + review + events) |
| `packages/db/src/client.ts` | Pool + client factory |
| `packages/db/src/migrate.ts` | Migration runner |
| `packages/db/src/repositories/review-reports.ts` | Review-report persistence |
| `packages/db/src/repositories/event-log.ts` | Append-only event log access |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/db test` passes against a throwaway PostgreSQL 16
- [ ] `pnpm --filter @harness/db migrate` applies cleanly on a fresh volume
- [ ] A review report with N findings + M suggestions round-trips with FK integrity
- [ ] `event_log` refuses UPDATE/DELETE at the access layer (append-only enforced)

## 6. Notes & Pitfalls

- Keep enum columns as constrained `text` (not native enums) so adding values later is a safe `INSERT`, mirroring the domain's "append, don't reorder" rule.
- FK and `on delete cascade` on findings/suggestions must follow the report so re-generation can cleanly detach children.

---

*Next: [Day 05 — Module boundaries + DI + dependency enforcement](day-05.md)*