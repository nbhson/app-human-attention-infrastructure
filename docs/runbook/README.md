# Operations Runbook

> **Incident-oriented, not component-oriented.** Each entry is
> _Symptom → Diagnose (exact command) → Resolve (exact command) → Escalate when._
> Every command here was executed against the real stack. If a command
> doesn't work as written, that's a runbook bug — fix it, don't improvise in an
> incident.

> **`review-reorient` (v0.6) — scope note.** The code-generation path — the
> dispatcher loop, the runtime loop, _and_ the startup reconciler
> (`apps/api/src/reconcile.ts`) — was retired. The live path is **review-only**:
> `POST /api/reviews` fetches an external PR + Jira ticket, the AI reviews it
> (report + findings + fix suggestions), and a `Task` is created then immediately
> `CANCELLED`. Three entries below are **historical only** and kept for provenance:
>
> - **R1** — orphan detector for `EXECUTING`/`VERIFYING` tasks; no live code path
>   reaches those states today. `agent_runs` / `trajectory_steps` are orphaned
>   tables. Kept for historical query reference only.
> - **R3** — verification timeout diagnostics; the `VERIFYING` state is retired,
>   but the `verification_check_results` query remains valid for sandbox timeouts.
> - **R4** — LLM cost diagnosis; the `retry_log` / `agent_runs` sub-queries are
>   retired, but the `llm_call_log` query (Q6) is live.
> - **R8** — the "startup reconciler recovers" claim is retired along with
>   `reconcile.ts`; nothing re-runs orphan recovery at boot.

The most useful sources of truth live next door:

- **[users-permissions.md](users-permissions.md)** — user model, role hierarchy, route
  permission matrix, and common operations for managing access.
- **[operations.md](operations.md)** — the _as-built_ procedures
  (v1.0-candidate): provider-token rotation (OP-1), write-back audit (OP-2),
  learning-loop HOLD (OP-3), the `rank_method` kill-switch (OP-4), and the
  durable-queue `EVENT_TRANSPORT` flag (OP-5).
- **[audit-queries.md](audit-queries.md)** — copy-paste SQL (Q1–Q9) for everything
  below that needs a database answer.
- **[limitations.md](limitations.md)** — deliberate boundaries. Read the
  first section of any incident against this; many "bugs" are the design.

**Scoping facts:** one API process, one Postgres, one shared `SANDBOX_ROOT`. The
API listens on `localhost:3000`. The database is reachable with:

```bash
docker compose exec -T postgres psql -U harness -d harness
```

---

## R1 — Task stuck in `EXECUTING` / `VERIFYING` ⚠️ HISTORICAL

> **RETIRED in `review-reorient`.** No live code path puts a task in `EXECUTING`
> or `VERIFYING`. The orphan detector and startup reconciler (`reconcile.ts`)
> were removed. This entry is preserved for historical reference and for querying
> old data in `task_state_history`.

**Symptom (historical):** a task sat in an in-flight state for > 10 minutes; the
review queue never saw it.

**Diagnose (historical):**

```bash
pnpm audit:orphans        # exit-code alarm over the same window (Q8)
# or by hand:
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT id, state, updated_at FROM tasks \
      WHERE state IN ('EXECUTING','VERIFYING') AND updated_at < now() - interval '10 minutes';"
```

If you see rows today, they are **historical artifacts from pre-`review-reorient`
runs**. No action needed — they are read-only historical data.

**Escalate when:** you see new `EXECUTING`/`VERIFYING` rows appearing after
`review-reorient` — that would indicate a regression, not expected behavior.

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
  are _never_ deferred. Wait for the next UTC day, or raise the budget — but read
  R5 before you do.
- Rows are `DROPPED` → a reviewer explicitly dropped them. The budget only
  _defers_ (stays `QUEUED`), it never drops — so `DROPPED` is a routing/signal
  problem to investigate, not a mechanical fix.
- `QUEUED` rows exist but nobody can claim → the reviewer identity is missing.
  The identity is the `reviewerId` field on every `claim`/`decide` body (the
  web UI defaults it from `VITE_REVIEWER_ID`, else `reviewer-1`). Confirm the
  caller sends it.

**Escalate when:** queue depth grows monotonically across two consecutive checks
with a healthy API and available reviewers — that's a routing/rectification bug.

---

## R3 — Verification always times out

**Symptom:** verification checks take longer than their budget.

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
timeout bump — file it as a **targeted/incremental verification** item
(the p95 latency driver), not as a bigger timeout.

---

## R4 — LLM cost spiking ⚠️ PARTIALLY RETIRED

> The `retry_log` and `agent_runs` sub-queries below are **retired** — those
> tables have no live writer. Keep only the `llm_call_log` query (Q6).

**Symptom:** token usage / cost climbs without a matching increase in completed work.

**Diagnose:**

```bash
# cost per task (Q6):
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT correlation_id, count(*) AS calls, sum(input_tokens), sum(output_tokens) \
      FROM llm_call_log WHERE correlation_id IS NOT NULL \
      GROUP BY 1 ORDER BY 4 DESC LIMIT 20;"
```

**Resolve:**

- Calls flat but cost growing → token-per-call rising. Check the prompt size
  (context-engine budget, memory injection) or model upgrade.
- Calls growing without corresponding reviews → double-review or retry loop.
  Check `review_reports.review_status` for stuck batches.

**Escalate when:** cost growth correlates with a prompt change — that's a prompt
engineering issue, not an ops knob.

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
  No action; the signal _is_ the healthy response.
- `attention.threshold_adjusted` firing with usefulness still falling → the
  nudge is self-correcting but the band is noisy; let it run.
- **Usefulness < 50% on `HIGH` for ~2 weeks** → the weights are untuned (they're
  explicit placeholders — `packages/attention-engine/README.md`). This is a **policy
  decision for weight calibration, not a code fix in production**. Escalate
  to the owner, don't hand-tune `PRIORITY_WEIGHTS`.

**Escalate when:** any of the above _except_ the "running as designed" case, and
only after the calibration path exists.

---

## R6 — Manual DB state fix (LAST RESORT)

**Symptom:** a task is in a state no code path can recover from; a human can
accept; you've exhausted R2–R5 and must move it by hand.

> **This is the last resort.** It bypasses the state machine's validators, so it is
> _your_ job to pick a valid transition (`packages/orchestrator/README.md`) and
> to leave a complete audit trail. Skipping the history row is forbidden — it makes
> the timeline un-replayable (audit-query Q2).

**Procedure:**

1. **Stop the API** so no loop races the row (`Ctrl-C` on `pnpm dev`, or the
   deploy's stop command).
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

| Signal               | Behaviour                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIGTERM` / `Ctrl-C` | Graceful: review ingest subscribers drain in-flight work, then the process exits. Do this when you can.                                                                                      |
| `SIGKILL`            | Not graceful. _(Post-`review-reorient`: there is no poll loop or startup reconciler — an in-flight review ingest request is simply lost; its `task.created` may or may not have committed.)_ |

Read [limitations.md](limitations.md) §1–§3 before running more than one process,
before expecting a message broker, or before "fixing" the nonexistent worker pool.

---

## R9 — Degradation fallback alerts (Day 26)

The opt-in subsystems degrade **loudly**: every fallback bumps a Prometheus-format
counter. A silent fallback is a subsystem that's "down" but quietly misbehaving —
the exact failure the degradation contract exists to prevent. There is no bundled
Prometheus/Grafana to scrape or page on the counters — point your own at the API's
`GET /metrics`:

```bash
curl -s localhost:3000/metrics \
  | grep -E 'harness_(context_semantic_fallback|object_store_(fallback|error|integrity_error)|sandbox_fallback)_total'
```

| Alert                          | Meaning (the fallback)                                       | Diagnose                                                                         | Response                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SemanticFallbackSustained`    | semantic shadow → keyword (`rank_method = keyword`)          | `curl -s localhost:3000/metrics \| grep harness_context_semantic_fallback_total` | The keyword path is serving **correctly** — this is fail-open. Check the embedder: is `EMBEDDINGS_BASE_URL` reachable (`curl -s $EMBEDDINGS_BASE_URL`)? Without it the shadow stops _measuring_, which silently unvalidated the Day-18 invariant.             |
| `ObjectStoreFallbackSustained` | oversize content inlined to db                               | `curl -s localhost:3000/metrics \| grep harness_object_store_fallback_total`     | The S3-compatible endpoint is down: check `OBJECT_STORE_ENDPOINT` reachability, then bucket/creds. The repo no longer provisions MinIO — you supply it. Bring it back before Postgres grows past sizing.                                                      |
| `ObjectStoreErrorSustained`    | writes fail-closed (caller rejected, never silent byte loss) | `grep harness_object_store_error_total`                                          | Same object-store triage, but _worse_: content at/over the inline ceiling is being **rejected**, not inlined. Check bucket/creds/disk.                                                                                                                        |
| `ObjectStoreIntegrityDrift`    | SHA-256 read-back mismatch                                   | `grep harness_object_store_integrity_error_total`                                | **Data-integrity incident, not availability.** A stored object's bytes no longer hash to its address — tampering or silent corruption. Open an incident immediately; do not just restart the object store.                                                    |
| `SandboxFallbackSustained`     | verification → in-process (no isolation)                     | `grep harness_sandbox_fallback_total`                                            | Docker daemon or the pinned image is unavailable: `docker images harness-verify:node20`; rebuild if missing (`docker build -t harness-verify:node20 packages/sandbox`). Fail-open, but isolation is the point (see `packages/sandbox/README.md`) — triage it. |

The degradation contract and exact counter are covered by each subsystem's
failure-injection tests (see `packages/object-store/src/__tests__/failure-injection.test.ts`
for the object-store case). There are no bundled alert thresholds — tune them
against your own real SLIs, not in an incident.

---

## R10 — Auto-approve kill-switch (Day 14)

Auto-approve is a **three-part gate** (calibration green ∧ flag on ∧ under the
bar), and two ADMIN-only endpoints govern its runtime flag. Both are one-shot and
immediately effective; both require `Role.Admin` (`requireRole` — anything else
gets 403, logged as `authz.decision_denied`).

**Disable the feature flag** (keeps the gate's other two legs intact):

```bash
curl -s -X POST localhost:3000/api/admin/auto-approve/enabled \
  -H 'content-type: application/json' \
  --cookie 'sid=<admin-session>' \
  -d '{"enabled": false}'
```

**Trip the kill-switch** (disable auto-approve _and_ requeue every in-flight
`AUTO_APPROVABLE` item to human review in one go):

```bash
curl -s -X POST localhost:3000/api/admin/auto-approve/kill \
  -H 'content-type: application/json' \
  --cookie 'sid=<admin-session>' \
  -d '{"reason": "usefulness fell below 50% on HIGH for 2 weeks — see R5"}'
```

**When to trip it:** `R5`'s usefulness-below-threshold signal, a routing surprise
where AUTO-APPROVED decisions look wrong, or any sampling-audit finding that
leakage is unacceptable. Tripping it does **not** destroy the gate's state — a
future `enabled: true` re-arms the flag, but the executor still refuses while
calibration is red (day-14 §6). Re-arm only after the cause is fixed and
re-verified against `auto_approve_kill_switch` + `assessments`.
