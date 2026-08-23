# Audit Query Cookbook (Day 27)

> **`review-reorient` (v0.6) — scope note.** Q8/Q9 (orphan detector / reconciler
> recovery) and the *Sample output* section below are historical: they reference
> `EXECUTING`/`VERIFYING` states, `task.orphan_recovered`, and the since-deleted
> `scripts/e2e-happy-path.ts`, all retired with code-gen. The live trace for a
> review is `review_reports` + `review_findings` + `fix_suggestions` (see Q10).
> Add Q10 below.

Copy-paste SQL to answer the questions an operator actually asks about the harness.
Each query is named, explained in one line, and runnable against a live database:

```bash
docker compose exec -T postgres psql -U harness -d harness
# or, if DATABASE_URL is exported:
#   psql "$DATABASE_URL"
```

> **Correlation ID is the join key.** In Phase 1, one `correlation_id` == one task's
> `tasks.id`. Every row a single task produces — `event_log`, `agent_runs`,
> `llm_call_log`, `verification_reports`, `decisions` — carries that id (day-27 §2.2).
> Join any two tables for one task on `correlation_id`.

**Table-name mapping** (the spec's §2.3 uses conceptual names; these are the real
Drizzle tables):

| Spec name | Actual table |
| --- | --- |
| `review_decisions` | `decisions` |
| `attention_assessments` | `assessments` |
| `assessment_feedback` | `assessment_feedback` |
| `verification_test_results` / `verification_check_results` | same |

---

## Q1 — Full lifecycle of one task ("what happened?")

Replays the ordered event trail for a task, with the failure `reason` (if any)
pulled out of the envelope.

```sql
SELECT occurred_at, event_type, payload->>'reason' AS reason
FROM event_log
WHERE correlation_id = :cid          -- replace with the task id
ORDER BY occurred_at;
```

## Q2 — State timeline with durations ("where did the time go?")

Each row is the time spent in the `from_state` before advancing to `to_state`.

```sql
SELECT from_state, to_state, occurred_at,
       occurred_at - LAG(occurred_at) OVER (ORDER BY occurred_at) AS dwell
FROM task_state_history
WHERE task_id = :task_id
ORDER BY occurred_at;
```

## Q3 — Rejection reasons, aggregated ("why do humans keep saying no?")

Feeds prompt/policy improvements. Uses the Day-24 `rationale` column; only the
`REJECTED` decision is considered.

```sql
SELECT lower(trim(rationale)) AS reason, count(*)
FROM decisions
WHERE decision = 'REJECTED'
  AND created_at > now() - interval '30 days'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20;
```

## Q4 — Alert-fatigue monitor ("is the engine crying wolf?")

Surfaces the Day-19 threshold/inflation events so a sleepy monitor is visible.

```sql
SELECT date_trunc('day', occurred_at) AS day,
       count(*) FILTER (WHERE event_type = 'attention.threshold_adjusted') AS threshold_adjustments,
       count(*) FILTER (WHERE event_type = 'attention.inflation_detected') AS inflation_alerts
FROM event_log
WHERE event_type LIKE 'attention.%'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 14;
```

## Q5 — Usefulness ratio per label ("is HIGH actually high?")

`was_useful` is a boolean; the average over decided items is the usefulness ratio.

```sql
SELECT a.label,
       count(*) AS decided,
       round(avg((f.was_useful)::int)::numeric, 3) AS usefulness
FROM assessment_feedback f
JOIN assessments a ON a.id = f.assessment_id
GROUP BY 1
ORDER BY 1;
```

## Q6 — LLM cost per task ("what did the model cost this week?")

`llm_call_log` has no `task_id` column — it carries `correlation_id` (== task id),
which is also why pre-runtime rows (no correlation) are excluded.

```sql
SELECT correlation_id AS task_id,
       count(*) AS calls,
       sum(input_tokens) AS in_tok,
       sum(output_tokens) AS out_tok
FROM llm_call_log
WHERE created_at > now() - interval '7 days'
  AND correlation_id IS NOT NULL
GROUP BY 1
ORDER BY 4 DESC
LIMIT 20;
```

## Q7 — Flaky-test leaderboard ("which tests are attention thieves?")

A `FLAKY` check is one that passed only after a retry; its leaf rows name the test.

```sql
SELECT t.test_name, count(*) AS flaky_count
FROM verification_test_results t
JOIN verification_check_results c ON c.id = t.check_result_id
WHERE c.status = 'FLAKY'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;
```

## Q8 — Orphan detector ("is a task stuck mid-flight?")

A **smoke alarm, not a fixer** (day-27 §6). Should return 0 rows; if it returns any,
a human investigates — never auto-"repair" an `EXECUTING` task from a cron.

```sql
SELECT id, state, updated_at
FROM tasks
WHERE state IN ('EXECUTING', 'VERIFYING')
  AND updated_at < now() - interval '10 minutes';
```

CLI wrapper (same window, wired as an exit-code alarm):

```bash
pnpm audit:orphans
```

## Q9 — Orphan recoveries ("what did the boot reconciler rescue?")

Only the startup reconciler may *act* on an orphan (limitations.md §3). This lists
every `task.orphan_recovered` event — the `reason` is always `PROCESS_DIED`, and
`payload->>'from_state'` names where the task was stranded.

```sql
SELECT occurred_at, correlation_id, payload->>'task_id'  AS task_id,
       payload->>'from_state' AS from_state,
       payload->>'reason'     AS reason
FROM event_log
WHERE event_type = 'task.orphan_recovered'
ORDER BY occurred_at;
```

Count recoveries per boot window (recoveries cluster right after a restart):

```sql
SELECT date_trunc('hour', occurred_at) AS hour, count(*)
FROM event_log
WHERE event_type = 'task.orphan_recovered'
GROUP BY 1
ORDER BY 1 DESC;
```

## Q10 — Review reports, findings, and fix suggestions ("what did the AI flag?")

The review slice (`POST /api/reviews`) lands its output in three tables. A
report has N findings (severity + file + line) and M fix suggestions (file +
hunk + proposed change). Join on `review_reports.id`.

```sql
-- latest reports
SELECT id, repo_path, pr_number, overall_verdict, summary, created_at
FROM review_reports
ORDER BY created_at DESC
LIMIT 20;

-- findings per report (most severe first)
SELECT report_id, severity, file, line, message
FROM review_findings
WHERE report_id = :report_id
ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
         WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END;

-- fix suggestions per report
SELECT report_id, file, proposed, rationale
FROM fix_suggestions
WHERE report_id = :report_id
ORDER BY file;
```

---

## Sample output (fresh E2E run)

Captured after `pnpm --filter @harness/api exec tsx scripts/e2e-happy-path.ts`, which
drives one task through the whole happy path to `COMPLETED`. The task id **is** the
correlation id: `01a026b7-cce9-73bd-90a2-6c2e138ab9f1`. Q3 / Q7 / Q8 are the
"something needs a human's attention" alarms, so a clean run legitimately returns
zero rows for them.

### Q1 — lifecycle of the task (13 events)

```text
        occurred_at         |          event_type          | reason
----------------------------+------------------------------+--------
 2026-08-21 23:46:14.991+00 | task.state_changed           |
 2026-08-21 23:46:14.996+00 | task.state_changed           |
 2026-08-21 23:46:15.003+00 | artifact.created             |
 2026-08-21 23:46:15.015+00 | task.execution_finished      |
 2026-08-21 23:46:15.037+00 | task.state_changed           |
 2026-08-21 23:46:15.365+00 | verification.completed       |
 2026-08-21 23:46:15.368+00 | task.state_changed           |
 2026-08-21 23:46:15.378+00 | attention.assessment_created |
 2026-08-21 23:46:15.381+00 | attention.item_routed        |
 2026-08-21 23:46:15.413+00 | task.state_changed           |
 2026-08-21 23:46:15.413+00 | review.decision_submitted    |
 2026-08-21 23:46:15.465+00 | task.state_changed           |
 2026-08-21 23:46:15.466+00 | artifact.merged              |
(13 rows)
```

### Q2 — state timeline with dwell times

```text
   from_state    |    to_state     |        occurred_at         |    dwell
-----------------+-----------------+----------------------------+--------------
 PENDING         | QUEUED          | 2026-08-21 23:46:14.99+00  |
 QUEUED          | EXECUTING       | 2026-08-21 23:46:14.995+00 | 00:00:00.005
 EXECUTING       | VERIFYING       | 2026-08-21 23:46:15.036+00 | 00:00:00.041
 VERIFYING       | AWAITING_REVIEW | 2026-08-21 23:46:15.367+00 | 00:00:00.331
 AWAITING_REVIEW | APPROVED        | 2026-08-21 23:46:15.412+00 | 00:00:00.045
 APPROVED        | COMPLETED       | 2026-08-21 23:46:15.464+00 | 00:00:00.052
(6 rows)
```

### Q3 — rejection reasons

Empty on a happy-path run (nothing was rejected):

```text
 reason | count
--------+-------
(0 rows)
```

### Q4 — alert-fatigue monitor (day bucket)

The `attention.*` events fired (`assessment_created`, `item_routed`) but none were the
Day-19 threshold/inflation alerts, so both counters are 0:

```text
          day           | threshold_adjustments | inflation_alerts
------------------------+-----------------------+------------------
 2026-08-21 00:00:00+00 |                     0 |                0
(1 row)
```

### Q5 — usefulness ratio per label

```text
 label | decided | usefulness
-------+---------+------------
 LOW   |       1 |      1.000
(1 row)
```

### Q6 — LLM cost per task

```text
               task_id                | calls | in_tok | out_tok
--------------------------------------+-------+--------+---------
 01a026b7-cce9-73bd-90a2-6c2e138ab9f1 |     3 |     36 |      26
(1 row)
```

### Q7 — flaky-test leaderboard

Empty on a happy-path run (the compile + test checks passed cleanly, no retries):

```text
 test_name | flaky_count
-----------+--------------
(0 rows)
```

### Q8 — orphan detector

Empty — the task never got stuck mid-flight, which is exactly the state you want:

```text
 id | state | updated_at
----+-------+------------
(0 rows)
```