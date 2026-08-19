# Day 27 — Observability: Logs, Correlation IDs & Audit Queries

| **Week** | Week 4 — Human Loop & E2E |
| --- | --- |
| **Spec refs** | Spec 1 §7 (Observability), Spec 2 §8 (Event Envelope) |
| **Estimated effort** | 1 day |
| **Prerequisites** | Day 03 (event_log), Day 06 (task_state_history), Day 19 (attention.inflation_detected / threshold_adjusted), Day 24 (rework rationale column), Day 26 (provenance) |

---

## 1. Objectives

1. Adopt a single structured-logging convention so every log line carries `correlation_id` and can be joined to `event_log`.
2. Guarantee correlation-ID propagation across the whole pipeline: API request → task → events → agent run → LLM calls → verification → review.
3. Ship an **audit query cookbook** — copy-paste SQL answering the questions operators actually ask ("why was this task rejected?", "are we crying wolf on HIGH labels?", "what did the LLM cost this week?").
4. Add a minimal ops endpoint (`GET /api/ops/health`, `GET /api/ops/metrics`) — no dashboard UI; the DB is the dashboard in Phase 1.

> **Why this matters:** A harness that routes human attention but can't explain its own behavior is untrustworthy. When someone asks "why did the system escalate this?", the answer must be one SQL query away — not a log-grep archaeology expedition. Observability here is not decoration; it is the feedback loop that keeps the Attention Engine honest (Day 19's inflation monitor is useless if nobody can see its events).

---

## 2. Design Decisions

### 2.1 Structured logging convention

One logger, one shape, everywhere. Use `pino` (fast, JSON-native, child loggers).

```ts
// packages/di/src/logger.ts
import pino from 'pino';

export type Logger = pino.Logger;

export function createRootLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    level,
    base: { service: 'harness' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/** Every subsystem logs through a child bound to the correlation context. */
export function withCorrelation(log: Logger, ctx: {
  correlationId: string;
  taskId?: string;
  agentRunId?: string;
}): Logger {
  return log.child(ctx);
}
```

Rules (enforced by code review + one lint test):

- **Every log line MUST include `correlation_id`** when one exists in scope. Lines without it are allowed only at process bootstrap.
- Log **events, not prose**: `log.info({ event_type: 'task.dispatched', attempt }, 'task dispatched')` — the structured field mirrors the event_log row.
- Never log secrets, file contents, or LLM request bodies (hashes only — `request_hash` from Day 11). `sanitizedEnv()` (Day 15) already keeps keys out of child processes; this keeps them out of logs.
- Level discipline: `error` = human action likely needed; `warn` = degraded but self-healing (retries, STALE context); `info` = state transitions and lifecycle; `debug` = everything else.

### 2.2 Correlation ID propagation

The envelope already has `correlation_id` (Day 03). Today we close the gaps:

| Hop | Mechanism |
| --- | --- |
| API → task creation | `POST /api/tasks` generates UUIDv7 `correlation_id`, stores on task row, returns it in the response header `X-Correlation-Id` |
| Task → events | Every event published during the task's lifecycle copies `task.correlation_id` (already true — verify with a test) |
| Events → subscribers | `EventLogWriter` and all subscribers receive the envelope; subscribers create child loggers via `withCorrelation` |
| Runtime → agent run | `agent_runs.correlation_id` column (add if missing — check Day 12 migration); ReActLoop logs each step with it |
| Agent → LLM calls | `llm_call_log.correlation_id` (add column today if absent) |
| Verification | `verification_reports.correlation_id` copied from the triggering event |
| Review | `review_decisions.correlation_id` copied from task |

**One propagation test to rule them all:** run the happy-path E2E, then assert that every row in `event_log`, `llm_call_log`, `verification_reports`, and `review_decisions` for that task shares the same `correlation_id`. If any row is null or different, propagation is broken — fix the leak, not the test.

### 2.3 Audit query cookbook

Ship as `docs/runbook/audit-queries.md` (Day 29 links it). Each query is named, explained in one line, and copy-paste runnable via `docker compose exec postgres psql -U harness`.

**Q1 — Full lifecycle of one task** (the "what happened?" query):

```sql
SELECT occurred_at, event_type, payload->>'reason' AS reason
FROM event_log
WHERE correlation_id = :cid
ORDER BY occurred_at;
```

**Q2 — State timeline with durations** (where did the time go?):

```sql
SELECT from_state, to_state, created_at,
       created_at - LAG(created_at) OVER (ORDER BY created_at) AS dwell
FROM task_state_history
WHERE task_id = :task_id
ORDER BY created_at;
```

**Q3 — Rejection reasons, aggregated** (feeds prompt/policy improvements; uses Day-24 rationale column):

```sql
SELECT lower(trim(rationale)) AS reason, count(*)
FROM review_decisions
WHERE decision = 'REJECTED' AND created_at > now() - interval '30 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
```

**Q4 — Alert-fatigue monitor** (Day 19 events made visible):

```sql
SELECT date_trunc('day', occurred_at) AS day,
       count(*) FILTER (WHERE event_type = 'attention.threshold_adjusted') AS threshold_adjustments,
       count(*) FILTER (WHERE event_type = 'attention.inflation_detected') AS inflation_alerts
FROM event_log
WHERE event_type LIKE 'attention.%'
GROUP BY 1 ORDER BY 1 DESC LIMIT 14;
```

**Q5 — Usefulness ratio per label** (is HIGH actually high?):

```sql
SELECT a.label,
       count(*) AS decided,
       avg((f.was_useful)::int) AS usefulness
FROM assessment_feedback f
JOIN attention_assessments a ON a.id = f.assessment_id
GROUP BY 1 ORDER BY 1;
```

**Q6 — LLM cost per task** (request_hash joins, tokens sum):

```sql
SELECT l.task_id, count(*) AS calls,
       sum(l.input_tokens) AS in_tok, sum(l.output_tokens) AS out_tok
FROM llm_call_log l
WHERE l.created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 4 DESC LIMIT 20;
```

**Q7 — Flaky-test leaderboard** (flaky tests are attention thieves):

```sql
SELECT t.test_name, count(*) AS flaky_count
FROM verification_test_results t
JOIN verification_check_results c ON c.id = t.check_result_id
WHERE c.status = 'FLAKY'
GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
```

**Q8 — Orphan detector** (should always return 0 rows; alarm if not):

```sql
SELECT id, state, updated_at FROM tasks
WHERE state IN ('EXECUTING','VERIFYING')
  AND updated_at < now() - interval '10 minutes';
```

### 2.4 Minimal ops endpoints

```ts
// apps/api/src/routes/ops.ts
fastify.get('/api/ops/health', async () => {
  await db.selectFrom('tasks').select('id').limit(1).execute(); // DB liveness
  return { ok: true, now: new Date().toISOString() };
});

fastify.get('/api/ops/metrics', async () => {
  const [byState] = await db.selectFrom('tasks')
    .select(['state', db.fn.countAll().as('n')]).groupBy('state').execute();
  const queueDepth = await db.selectFrom('review_queue')
    .where('status', '=', 'QUEUED').select(db.fn.countAll().as('n')).executeTakeFirstOrThrow();
  const orphans = await runOrphanQuery(db); // Q8
  return { tasksByState: byState, reviewQueueDepth: queueDepth.n, orphanedTasks: orphans.length };
});
```

Deliberately **not** building: Prometheus exporters, Grafana, log aggregation. Phase 1 runs on one machine with `docker compose logs` and `psql`. The cookbook *is* the observability UI.

---

## 3. Tasks

### 3.1 Logging foundation (2h)
- [ ] Add `pino` to `packages/di`; implement `createRootLogger` / `withCorrelation`
- [ ] Register root logger in `Container` (TOKENS.LOGGER); replace every `console.log` in `packages/*` and `apps/api` (grep to prove zero remain)
- [ ] Lint test: no `console.` outside `scripts/`

### 3.2 Correlation propagation (2h)
- [ ] Migration `0023_observability.sql`: add `correlation_id` to `llm_call_log`, `verification_reports`, `review_decisions` (nullable→backfill→not null where feasible)
- [ ] Wire `X-Correlation-Id` response header in task creation route
- [ ] Write the cross-table propagation test (§2.2)

### 3.3 Audit cookbook (1.5h)
- [ ] Write `docs/runbook/audit-queries.md` with Q1–Q8, each verified by actually running it against the E2E-populated database
- [ ] Add `pnpm audit:orphans` script wrapping Q8

### 3.4 Ops endpoints (1h)
- [ ] Implement `/api/ops/health` and `/api/ops/metrics` with tests
- [ ] Wire into `bootstrap.ts`; update `docs/architecture/wiring-map.md`

### 3.5 Verification (1.5h)
- [ ] Re-run `pnpm e2e`; then execute every cookbook query against the resulting DB and paste real output into the cookbook (proof, not theory)
- [ ] `pnpm test && pnpm lint` green

---

## 4. Deliverables

| File | Description |
| --- | --- |
| `packages/di/src/logger.ts` | pino root logger + `withCorrelation` child-logger helper |
| `packages/db/migrations/0023_observability.sql` | correlation_id columns on llm_call_log, verification_reports, review_decisions |
| `apps/api/src/routes/ops.ts` | /api/ops/health + /api/ops/metrics |
| `docs/runbook/audit-queries.md` | Q1–Q8 cookbook with real sample output |
| `scripts/audit-orphans.ts` | Q8 wrapper (`pnpm audit:orphans`) |
| `apps/api/test/correlation-propagation.test.ts` | Cross-table correlation_id invariant test |

---

## 5. Acceptance Criteria

- [ ] Zero `console.*` calls outside `scripts/` (lint test enforces)
- [ ] Every log line emitted during an E2E task run carries that task's `correlation_id`
- [ ] Cross-table propagation test passes: one correlation_id across event_log, llm_call_log, verification_reports, review_decisions
- [ ] All 8 cookbook queries run successfully against a real E2E-populated database; sample outputs committed in the doc
- [ ] `GET /api/ops/health` returns 200 with DB check; `/api/ops/metrics` returns state counts, queue depth, orphan count
- [ ] Q8 orphan detector returns 0 rows after full E2E suite (including Day-26 SIGTERM scenario)
- [ ] `pnpm test && pnpm lint` green; boundary tests pass

---

## 6. Notes & Pitfalls

- **Correlation ID is not a trace ID.** Phase 1 has one ID per task lifecycle, not per-request spans. That's enough to answer every audit question in the cookbook. OpenTelemetry is Phase 2+ — note it in the Day-30 backlog, don't build it.
- **Don't log payloads.** `event_log` already stores them durably; duplicating them into logs doubles your PII/secrets exposure surface for zero gain. Log the `event_type` and IDs; query the DB for bodies.
- **The orphan query is a smoke alarm, not a fixer.** If Q8 returns rows, a human investigates (runbook, Day 29). Never auto-"repair" EXECUTING tasks from a cron — that's how you get two agents on one task.
- **Verify queries against real data.** A cookbook full of untested SQL is fiction. The acceptance criterion of pasting real output is deliberate — it also gives Day-29's runbook concrete examples.
- **Next:** [Day 28 — Hardening: Concurrency, Failure Injection & Load Smoke](day-28.md).

---

*Prev: [Day 26 — E2E: Failure Paths & Provenance UI](day-26.md) | Next: [Day 28 — Hardening: Concurrency, Failure Injection & Load Smoke](day-28.md)*
