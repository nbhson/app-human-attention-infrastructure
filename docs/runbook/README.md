# Operations Runbook

> **Incident-oriented, not component-oriented.** Each entry is
> *Symptom → Diagnose (exact command) → Resolve (exact command) → Escalate when.*
> Every command here was executed against the real stack on Day 29. If a command
> doesn't work as written, that's a runbook bug — fix it, don't improvise in an
> incident.

The two most useful sources of truth live next door:

- **[audit-queries.md](audit-queries.md)** — copy-paste SQL (Q1–Q9) for everything
  below that needs a database answer.
- **[limitations.md](limitations.md)** — deliberate Phase-1 boundaries. Read the
  first section of any incident against this; many "bugs" are the design.

**Scoping facts:** one API process, one Postgres, one shared `SANDBOX_ROOT`. The
API listens on `localhost:3000`. The database is reachable with:

```bash
docker compose exec -T postgres psql -U harness -d harness
```

---

## R1 — Task stuck in `EXECUTING` / `VERIFYING`

**Symptom:** a task sits in an in-flight state for > 10 minutes; the review queue
never sees it.

**Diagnose:**

```bash
pnpm audit:orphans        # exit-code alarm over the same window (Q8)
# or by hand:
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT id, state, updated_at FROM tasks \
      WHERE state IN ('EXECUTING','VERIFYING') AND updated_at < now() - interval '10 minutes';"
```

Then split on *who died*:

```bash
# Is the API process even alive?
curl -s localhost:3000/api/ops/health
```

**Resolve:**

- **Process died (healthcheck unreachable):** restart it — `pnpm dev` (or the
  deploy's start command). The **startup reconciler** (`apps/api/src/reconcile.ts`)
  runs once at boot, before any loop starts, and escorts each orphan to
  `AWAITING_HUMAN_INTERVENTION` (`reason = PROCESS_DIED`), publishing
  `task.orphan_recovered`. Verify with audit-query Q9. You're done.
- **Process is alive:** the agent is genuinely stuck inside a run. Pull its
  trail and decide:

  ```bash
  docker compose exec -T postgres psql -U harness -d harness \
    -c "SELECT * FROM agent_runs WHERE task_id = '<TASK_ID>' ORDER BY started_at DESC LIMIT 1;"

  # its step-by-step trajectory (substitute the run id):
  docker compose exec -T postgres psql -U harness -d harness \
    -c "SELECT step_number, thought, tool_name, observation FROM trajectory_steps \
        WHERE agent_run_id = '<RUN_ID>' ORDER BY step_number;"
  ```

  If the model is looping / out of budget, follow R6 to move it to
  `AWAITING_HUMAN_INTERVENTION`.

**Escalate when:** the reconciler recovered a task you did not expect to be stuck
(Q9 shows a recovery right after a restart that *shouldn't* have crashed), or the
same task gets stranded repeatedly. That's a product bug, not an ops fix.

> **Never "repair" an `EXECUTING`/`VERIFYING` row from a cron.** The orphan
> detector is a smoke alarm, not a fixer; only the startup reconciler may act
> (limitations.md §3).

---

## R2 — Review queue not draining

**Symptom:** items sit in the queue; reviewers claim nothing.

**Diagnose:**

```bash
curl -s localhost:3000/api/ops/metrics
# → tasksByState, reviewQueueDepth, orphanedTasks
```

```bash
# What state are the queue rows actually in?
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT status, action, count(*) FROM review_queue GROUP BY 1, 2;"
```

**Resolve:**

- Everything is still `QUEUED` (and `action` is low-severity) → the queue isn't
  stuck, it's **deferred by the daily review budget** (Day 19): once today's
  `DECIDED`+`CLAIMED` count reaches `fatigue.dailyReviewBudget` (20), low-severity
  items stay `QUEUED` (flagged) instead of surfacing. `ESCALATE`/`REVIEW_REQUIRED`
  are *never* deferred. Wait for the next UTC day, or raise the budget — but read
  R5 before you do.
- Rows are `DROPPED` → a reviewer explicitly dropped them. The budget only
  *defers* (stays `QUEUED`), it never drops — so `DROPPED` is a routing/signal
  problem to investigate, not a mechanical fix.
- `QUEUED` rows exist but nobody can claim → the reviewer identity is missing.
  Phase-1 identity is the `reviewerId` field on every `claim`/`decide` body (the
  web UI defaults it from `VITE_REVIEWER_ID`, else `reviewer-1`). Confirm the
  caller sends it.

**Escalate when:** queue depth grows monotonically across two consecutive checks
with a healthy API and available reviewers — that's a routing/rectification bug.

---

## R3 — Verification always times out

**Symptom:** tasks stall in `VERIFYING`; the dwell query shows them lingering.

**Diagnose:**

```bash
# per-check status distribution — are they TIMED_OUT?
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT status, count(*) FROM verification_check_results GROUP BY 1;"

# disk pressure on the sandbox host:
df -h "$(pwd)"
```

**Resolve:**

- `TIMED_OUT` dominating → the check is legitimately too slow for its budget.
  Confirm the worktree isn't bloated (nested `node_modules`, stale `dist`), then
  raise the per-check timeout (`CompileCheck`/`TestCheck` carry their own budget)
  **with the dwell evidence attached** — never tune a timeout on a hunch.
- Disk full → clean the worktree; this is an environment fix, not a code fix.

**Escalate when:** timeouts persist after an environment fix and a justified
timeout bump — file it as a Phase-2 **targeted/incremental verification** item
(the p95 latency driver), not as a bigger timeout.

---

## R4 — LLM cost spiking

**Symptom:** token usage / cost climbs without a matching increase in completed work.

**Diagnose:**

```bash
# cost per task (Q6):
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT correlation_id, count(*) AS calls, sum(input_tokens), sum(output_tokens) \
      FROM llm_call_log WHERE correlation_id IS NOT NULL \
      GROUP BY 1 ORDER BY 4 DESC LIMIT 20;"

# retry storms:
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT failure_class, count(*) FROM retry_log GROUP BY 1;"

# max-steps / budget escalations (a runaway loop bills every step):
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT escalation_reason, count(*) FROM agent_runs \
      WHERE escalation_reason IS NOT NULL GROUP BY 1;"
```

**Resolve:**

- Retry storm (`TRANSIENT`/`RESOURCE` dominating `retry_log`) → the dependency is
  flaky or a quota is exhausted; the retry backoff is doing its job but each
  retry bills. Address the dependency (rate-limit headroom, quota) rather than
  the retry count.
- `MAX_STEPS_EXCEEDED` / `TOKEN_BUDGET_EXCEEDED` climbing → tasks are over-scoped
  or the model is spinning. Lower `AGENT_MAX_STEPS` / the token budget (they're
  env-configurable) only with the escalation evidence; the real fix is prompt or
  task decomposition.

**Escalate when:** calls are flat but cost grows (token per call rising) — that's
a prompt/context-bloat problem for the Phase-2 **exact tokenizer + context cache**
work, not an ops knob.

---

## R5 — Alert-fatigue signals (is the engine crying wolf?)

**Symptom:** reviewers report too many items routed their way, or too few; the
priority labels feel wrong.

**Diagnose:**

```bash
# threshold adjustments + inflation alerts (Q4):
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT event_type, count(*) FROM event_log \
      WHERE event_type LIKE 'attention.%' \
        AND event_type IN ('attention.threshold_adjusted','attention.inflation_detected') \
      GROUP BY 1;"

# label usefulness (Q5):
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT a.label, count(*), round(avg((f.was_useful)::int)::numeric,3) AS usefulness \
      FROM assessment_feedback f JOIN assessments a ON a.id = f.assessment_id \
      GROUP BY 1 ORDER BY 1;"
```

**Resolve:**

- `attention.inflation_detected` recurring → the adaptive-threshold machinery is
  **working as designed** (it bounds the HIGH share to the configured ceiling).
  No action; the signal *is* the healthy response.
- `attention.threshold_adjusted` firing with usefulness still falling → the
  nudge is self-correcting but the band is noisy; let it run.
- **Usefulness < 50% on `HIGH` for ~2 weeks** → the weights are untuned (they're
  explicit placeholders — `6_Attention_Engine_v0.2.md` §3). This is a **policy
  decision for Phase 2 weight calibration, not a code fix in production**. Escalate
  to the owner, don't hand-tune `PRIORITY_WEIGHTS`.

**Escalate when:** any of the above *except* the "running as designed" case, and
only after the calibration path (Phase 2) exists.

---

## R6 — Manual DB state fix (LAST RESORT)

**Symptom:** a task is in a state no code path can recover from a human can accept;
you've exhausted R1–R5 and must move it by hand.

> **This is the last resort.** It bypasses the state machine's validators, so it is
> *your* job to pick a valid transition (`2_Task_Work_Orchestrator_v0.2.md` §3) and
> to leave a complete audit trail. Skipping the history row is forbidden — it makes
> the timeline un-replayable (audit-query Q2).

**Procedure:**

1. **Stop the API** so no loop races the row (`Ctrl-C` on `pnpm dev`, or the
   deploy's stop command). The reconciler does *not* run here.
2. Open a transaction and make **all three writes**:

```sql
BEGIN;

UPDATE tasks
   SET state = '<NEW_STATE>', updated_at = now()
 WHERE id = '<TASK_ID>' AND state = '<EXPECTED_FROM_STATE>';
-- MUST report: UPDATE 1. Anything else → ROLLBACK and re-diagnose.

INSERT INTO task_state_history
  (id, task_id, from_state, to_state, triggered_by, rationale, attempt_number)
VALUES
  ('<gen-uuid>', '<TASK_ID>', '<FROM_STATE>', '<NEW_STATE>',
   '<YOUR_NAME>', 'MANUAL_INTERVENTION',
   (SELECT attempt_number FROM tasks WHERE id = '<TASK_ID>'));

INSERT INTO event_log
  (event_id, event_type, event_version, occurred_at, correlation_id, payload)
VALUES
  ('<gen-uuid>', 'task.state_changed', 1, now(), '<TASK_ID>',
   '{"from_state":"<FROM_STATE>","to_state":"<NEW_STATE>","reason":"MANUAL_INTERVENTION"}'::jsonb);

COMMIT;
```

3. **Restart the API.** Verify the audit trail with Q1 (event present) and Q2
   (history row present with `triggered_by = <YOUR_NAME>`).

**Escalate when:** the task needs another move within a day — a second manual fix
means the underlying code bug is still live and becomes the priority ticket.

---

## R7 — Full reset (DEV ONLY)

**Symptom:** you want a clean slate in a disposable environment.

```bash
docker compose down -v && docker compose up -d && pnpm --filter @harness/db migrate
```

**This destroys everything** — the `pgdata` volume is deleted. It has no guard,
no confirmation, no "are you sure". **Never run it in any shared, staging, or
production environment.** If you're tempted there, you want R6 (targeted), not R7
(nuclear).

---

## R8 — Startup / shutdown

```bash
docker compose up -d      # Postgres only; the API is run separately
pnpm dev                  # Fastify API on :3000 (+ hot reload)
# or, built artifact:
pnpm build && pnpm --filter @harness/api start
```

| Signal | Behaviour |
| --- | --- |
| `SIGTERM` / `Ctrl-C` | Graceful: both poll loops halt, then in-flight ticks drain. Do this when you can. |
| `SIGKILL` | Not graceful, but **safe**: the startup reconciler recovers any stranded task on next boot (R1). The only loss is in-flight LLM calls (billed, un-recorded to `llm_call_log`). |

Read [limitations.md](limitations.md) §1–§3 before running more than one process,
before expecting a message broker, or before "fixing" the nonexistent worker pool.