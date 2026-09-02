# Audit Query Cookbook (Day 27)

> **`review-reorient` (v0.6) — scope note.** Q8/Q9 (orphan detector / reconciler
> recovery) were retired with the code-generation path. The startup reconciler
> (`apps/api/src/reconcile.ts`) no longer exists; there are no `EXECUTING`/`VERIFYING`
> tasks to recover. The live trace for a review is `review_reports` +
> `review_findings` + `fix_suggestions` (Q10). This document keeps only the
> queries that apply today.

Copy-paste SQL to answer the questions an operator actually asks about the harness.
Each query is named, explained in one line, and runnable against a live database:

```bash
docker compose exec -T postgres psql -U harness -d harness
# or, if DATABASE_URL is exported:
#   psql "$DATABASE_URL"
```

> **Correlation ID is the join key.** One `correlation_id` == one task's
> `tasks.id`. Every row a single task produces — `event_log`, `llm_call_log`,
> `verification_reports`, `decisions`, `review_reports`, `review_findings` — carries
> that id (day-27 §2.2). Join any two tables for one task on `correlation_id`.

**Table-name mapping** (the spec's §2.3 uses conceptual names; these are the real
Drizzle tables):

| Spec name                                                  | Actual table          |
| ---------------------------------------------------------- | --------------------- |
| `review_decisions`                                         | `decisions`           |
| `attention_assessments`                                    | `assessments`         |
| `assessment_feedback`                                      | `assessment_feedback` |
| `verification_test_results` / `verification_check_results` | same                  |

---

## Q1 — Full lifecycle of one task ("what happened?")

Replays the ordered event trail for a task, with the failure `reason` (if any)
pulled out of the envelope. In the review-only slice, the typical flow is
`task.created → task.state_changed(CANCELLED)` — the task is created purely to
anchor provenance, then immediately cancelled (the retired dispatcher used to
pull it into `EXECUTING`).

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

## Q8 — Review reports, findings, and fix suggestions ("what did the AI flag?")

The review slice (`POST /api/reviews`) lands its output in three tables. A
report has N findings (severity + file + line) and M fix suggestions (file +
hunk + proposed change). Join on `review_reports.id`.

The `review_status` column tracks the async pipeline stage (`pending` →
`fetching` → `recalling` → `reviewing` → `storing` → `complete` / `error`).
The `batch_progress` column (`{ current, total }`) shows how many batches
are done during the `reviewing` stage.

```sql
-- latest reports with status
SELECT id, repo, pr_number, overall_verdict, review_status, batch_progress, summary, created_at
FROM review_reports
ORDER BY created_at DESC
LIMIT 20;

-- reports still being processed (stuck or slow)
SELECT id, repo, pr_number, review_status, batch_progress, created_at
FROM review_reports
WHERE review_status NOT IN ('complete', 'error')
  AND created_at < now() - interval '5 minutes';

-- findings per report (most severe first)
SELECT report_id, severity, file, line, message
FROM review_findings
WHERE report_id = :report_id
ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1
         WHEN 'MINOR' THEN 2 WHEN 'NIT' THEN 3 ELSE 4 END;

-- fix suggestions per report
SELECT report_id, file, proposed, rationale
FROM fix_suggestions
WHERE report_id = :report_id
ORDER BY file;
```

## Q9 — The unified `/api/audit` timeline (every trail, one stream)

The web audit tab (`/audit`) reads this endpoint instead of running SQL: it merges
the append-only sources — `event_log` + `llm_call_log` — into one newest-first
list, one row per fact, with the full source payload in `detail` for click-through.

```bash
curl -s 'localhost:3000/api/audit?limit=100' \
  --cookie 'sid=<operator-session>' | jq '.items[] | {kind, title, summary}'
```

| Query param     | Default       | Meaning                                               |
| --------------- | ------------- | ----------------------------------------------------- |
| `limit`         | 100 (max 500) | rows fetched per source before the cross-source merge |
| `before`        | now           | ISO-8601 cursor; returns strictly-older rows          |
| `kind`          | all           | restrict to `event` \| `llm`                          |
| `eventType`     | all           | restrict events to one type (e.g. `system.started`)   |
| `correlationId` | all           | restrict every source to one task/session id          |

`kind` names the row types: `event` (bus events, including the
`system.started` / `system.stopped` boot markers), `llm` (model calls).
The response is `{ items, nextBefore }`; pass `before=nextBefore` to page older.
The endpoint requires an Operate/Reviewer/Admin session (`requireRole`).

---

## Sample output (fresh E2E review run)

Captured after a `POST /api/reviews` through the happy path. The task id **is**
the correlation id: `01a026b7-cce9-73bd-90a2-6c2e138ab9f1`. Q3 / Q4 / Q7 are the
"something needs a human's attention" alarms, so a clean run legitimately returns
zero rows for them.

### Q1 — lifecycle of the review task (events)

In the review-only slice the task is created and immediately cancelled — it serves
as a provenance anchor. The meaningful events live in `review_reports`:

```text
         occurred_at         |          event_type          | reason
----------------------------+------------------------------+--------
 2026-09-02 18:22:45.120+00 | task.created                 |
 2026-09-02 18:22:45.122+00 | task.state_changed           | PENDING → CANCELLED
 2026-09-02 18:22:45.200+00 | review.requested             |
 2026-09-02 18:22:46.500+00 | review.report_created        |
 2026-09-02 18:22:46.510+00 | attention.assessment_created |
 2026-09-02 18:22:46.512+00 | attention.item_routed        |
(6 rows)
```

### Q2 — state timeline with dwell times

```text
   from_state    |    to_state     |        occurred_at         |    dwell
-----------------+-----------------+----------------------------+--------------
 PENDING         | CANCELLED       | 2026-09-02 18:22:45.122+00 | 00:00:00.002
(1 row)
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
 2026-09-02 00:00:00+00 |                     0 |                0
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
 01a026b7-cce9-73bd-90a2-6c2e138ab9f1 |     2 |     42 |      31
(1 row)
```

### Q7 — flaky-test leaderboard

Empty on a happy-path run (the compile + test checks passed cleanly, no retries):

```text
 test_name | flaky_count
-----------+--------------
(0 rows)
```

### Q8 — review reports and findings

```text
 id                                 | pr_url                                    | overall_verdict    | review_status | summary
--------------------------------------+-------------------------------------------+--------------------+---------------+---------------------------------------------------
 01a0635d-eee0-738b-beab-1437868b3bef | https://github.com/acme/api/pull/302      | REQUEST_CHANGES    | complete      | Adds /widget; the payload dereference needs a guard.
(1 row)

 report_id | severity | file              | line | message
-----------+----------+-------------------+------+------------------------------------------
 01a0...   | CRITICAL | src/widget.ts     | 42   | Missing null check on user input
 01a0...   | MINOR    | README.md         |      | Typo in endpoint description
(2 rows)
```
