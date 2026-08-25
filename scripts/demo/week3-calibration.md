# Week 3 Live Demo — Calibration & Auto-Approve

*Phase 2 · day-15 checkpoint. A narrated runbook: extract a frozen calibration
dataset from the live decision log, fit five weights from it, read the before/after
table the fit actually produced — then drive the gated auto-approve path and trip
its kill-switch. Every command below is the real code path; the fit numbers in
§2 are the ones `pnpm eval:fit` printed into this repo's dev database, not a
hand-authored table.*

> Two of the three beats are **honest by construction**, and the honest result is
> a red one: on this repo's tiny seed corpus the fitted weights did **not** beat the
> Phase-1 placeholder (log-loss 0.316 vs 0.262 on a one-row held-out set), so the
> gate refuses auto-approve and the placeholder stays active. That is the correct
> outcome of a hard checkpoint (§6 of the day-15 spec) — the pipeline measured the
> fit and *declined* to promote it. The third beat then proves the auto-approve
> machinery works *when* calibration is green, using an explicit green fixture
> (the same one the Day-14 tests use), and shows the kill-switch re-opening an
> in-flight item to a human.

---

## 0. Prereqs & clean stack

```bash
docker compose down -v        # fresh postgres
docker compose up -d          # wait for postgres healthy

pnpm --filter @harness/db migrate   # apply migrations (includes 0022 auto-approve + calibration)
pnpm seed:metrics-checkpoint  # prime a decidable review window (real actor + was_useful)
pnpm eval:make-dataset --label=outcome   # §1
pnpm eval:fit --dataset=<id>             # §2
pnpm dev                      # API on http://localhost:3000 for §3
```

Run identity in mock mode for §3 (the ADMIN principal must pass `requireRole(ADMIN)`):

```bash
OIDC_MOCK=true \
MOCK_OIDC_SUB='admin@demo' \
MOCK_OIDC_EMAIL='admin@example.com' \
MOCK_OIDC_NAME='Demo Admin' \
  pnpm dev
```

---

## 1. Extract the calibration dataset — `pnpm eval:make-dataset`

The Day-11 extractor snapshots the four-way join (assessment → feedback →
decision → rework provenance) into a frozen, hash-sealed dataset and prints its
coverage. The label mode is `outcome` (the objective APPROVED/REJECTED/REWORKED
lens) for the fit, per the day-15 objective.

> **Pitfall (real):** the flag is `--label=outcome` with an **equals sign**. The
> space form `--label outcome` is silently ignored by `parseLabel` (it only reads
> `--label=`) and falls back to `feedback` — you get a dataset, just not the one
> you asked for. The day-15 plan wrote the space form; the CLI contract is the
> equals form.

```bash
pnpm eval:make-dataset --label=outcome
```

```json
{
  "dataset": {
    "id": "01a02937-859f-784e-bbef-56d9cdb5e4d6",
    "labelSource": "outcome",
    "sourceVersion": "v0.2.0-harness",
    "defectLagHorizon": "unbounded",
    "rowCount": 5,
    "contentHash": "e88c5bde61336a0b21f16796644076d5a6631588e550b389efcbbd3c4f17e22a"
  },
  "coverage": {
    "total": 5,
    "withFeedback": 3,
    "withNullFeedback": 2,
    "nullShare": 0.4,
    "byLabelSource": { "outcome": 5 },
    "byOutcome": { "APPROVED": 4, "REJECTED": 1 },
    "byWasUseful": { "useful": 1, "notUseful": 2, "null": 2 }
  }
}
```

**Beat:** five rows, class balance 4 APPROVED vs 1 REJECTED, 40% of rows carry no
feedback. That is a **real** dataset, hash-sealed so no later retcon changes what
the fit saw — and it is also a *five-row* dataset, which is exactly the number the
retro must not wave away.

---

## 2. Fit the weights — `pnpm eval:fit`

The Day-12 fitter trains a logistic-regression weight vector on 80% of the rows
and reports before/after on the held-out 20%:

```bash
pnpm eval:fit --dataset=01a02937-859f-784e-bbef-56d9cdb5e4d6
```

```json
{
  "datasetId": "01a02937-859f-784e-bbef-56d9cdb5e4d6",
  "labelSource": "outcome",
  "method": "logistic-regression-v0/softmax",
  "seed": 42,
  "validationShare": 0.2,
  "trainCount": 4,
  "validationCount": 1,
  "fittedWeights": { "risk": 0.2, "impact": 0.2, "novelty": 0.2, "complexity": 0.2, "confidence": 0.2 },
  "bias": -1.0291980478026117,
  "placeholder": {
    "weights": { "risk": 0.35, "impact": 0.25, "novelty": 0.15, "complexity": 0.1, "confidence": 0.15 },
    "logLoss": 0.2618843796306402,
    "rankingAccuracy": 1
  },
  "fitted": {
    "logLoss": 0.3158072361776291,
    "rankingAccuracy": 1
  },
  "improvement": false,
  "governanceNote": "fitted weights did not beat the Phase-1 placeholder on held-out validation; the placeholder stays active"
}
```

The before/after table, read straight off that JSON:

| | `log_loss` | `ranking_accuracy` | weight vector |
|---|---|---|---|
| **Placeholder (v0.2 Phase-1)** | **0.262** | 1.0 | `risk .35 · impact .25 · novelty .15 · complexity .10 · confidence .15` |
| **Fitted (logistic-regression-v0)** | 0.316 | 1.0 | uniform 0.2 across all five factors |

**Beat:** the fit is *measured, not asserted* — `improvement: false`, and the
governance note is set. Fitted log-loss (0.316) is *worse* than the placeholder
(0.262); ranking accuracy ties at 1.0 because a one-row held-out set can only be
perfect or perfectly wrong. The honest consequence demonstrates itself in the next
beat: with this red fit on record, the auto-approve gate refuses to fire, even if
an admin flips the flag. The system *declines to promote a regression* — which is
the checkpoint working as designed, not a failure to ship.

---

## 3. Auto-approve — gated, then killed

### 3.1 The red fit blocks auto-approve (governance denial)

An ADMIN flips the flag on, but the red fit from §2 is the latest
`calibration_weights` row, so the executor's gate denies the item before any
decision is written. Log in through the mock OIDC exchange to get an ADMIN session:

```bash
curl -s -c /tmp/harness.jar -o /dev/null http://localhost:3000/api/auth/login
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' http://localhost:3000/api/auth/login)
curl -s -b /tmp/harness.jar -c /tmp/harness.jar "$LOC" | jq .user.mail   # admin@example.com

# flip the flag ON — legal, but not sufficient (§6: flag is the last gate, not the only one)
curl -s -b /tmp/harness.jar -X POST http://localhost:3000/api/admin/auto-approve/enabled \
  -H 'content-type: application/json' -d '{"enabled":true}' | jq .
#   { "autoApproveEnabled": true }
```

Route a LOW item (combined priority 0.1 < bar 0.2, so it *would* clear part 3):

```bash
psql "${DATABASE_URL:-postgres://harness:harness@localhost:5432/harness}" <<'SQL'
INSERT INTO projects        (id, name, repo_path)   VALUES ('demo-prj','demo-ng','fixtures/demo');
INSERT INTO tasks           (id, project_id, title, state, idempotency_key)
     VALUES ('demo-task','demo-prj','Demo LOW change','AWAITING_REVIEW','demo-ik');
INSERT INTO agent_runs      (id, task_id, status, max_steps)  VALUES ('demo-run','demo-task','COMPLETED',10);
INSERT INTO artifacts       (id, project_id, file_path, status) VALUES ('demo-art','demo-prj','src/i.ts','PENDING_REVIEW');
INSERT INTO changes         (id, artifact_id, agent_run_id, change_type, status, content_hash, diff_summary)
     VALUES ('demo-chg','demo-art','demo-run','CREATED','VERIFIED','h','demo diff');
INSERT INTO assessments     (id, artifact_id, change_id, risk_score, impact_score, novelty_score,
                             complexity_score, confidence_score, combined_priority, label, factors_unavailable)
     VALUES ('demo-ass','demo-art','demo-chg',0.1,0.1,0.1,0.1,0.1,0.1,'LOW','{}');
INSERT INTO review_queue    (id, task_id, assessment_id, action, policy_version, rule_id, position, status)
     VALUES ('demo-q','demo-task','demo-ass','AUTO_APPROVABLE',1,'r5-low',1,'QUEUED');
SQL
```

When `attention.item_routed` fires for that queue row, the executor denies it —
and because the denial is *not silent*, the refusal is visible in the log and the
item stays `QUEUED` (no decision row is written):

```bash
psql "$DATABASE_URL" -c "SELECT decision FROM decisions WHERE change_id = 'demo-chg';"  # (0 rows)
psql "$DATABASE_URL" -c "SELECT status FROM review_queue WHERE id = 'demo-q';"          # QUEUED
```

### 3.2 A green fit unlocks the path

Seed an explicit green fit (the same `GREEN_CALIBRATION` fixture the Day-14 tests
use — fitted log-loss *below* placeholder, ranking not worse). This is a **fixture**,
clearly marked: it is *not* a claim that §2's fit was green, it is the precondition
that makes the auto-approve machinery demonstrable.

```bash
psql "$DATABASE_URL" <<'SQL'
INSERT INTO calibration_datasets (id, label_source, row_count, content_hash, source_version, defect_lag_horizon)
     VALUES ('ds-green','feedback',1,'h-green','v1','unbounded');
INSERT INTO calibration_weights (id, dataset_id, method, weights, fit_config,
                                 log_loss_fitted, log_loss_placeholder,
                                 ranking_accuracy_fitted, ranking_accuracy_placeholder)
     VALUES ('w-green','ds-green','logistic-regression-v0','{}','{}', 0.3, 0.5, 0.8, 0.7);
SQL
```

Prime a second LOW item (the fixture SQL is the Day-14 test's `seedAutoApprovable`
chain, real rows):

```bash
psql "$DATABASE_URL" <<'SQL'
INSERT INTO tasks           (id, project_id, title, state, idempotency_key)
     VALUES ('demo-task-2','demo-prj','Demo LOW batch 2','AWAITING_REVIEW','demo-ik-2');
INSERT INTO agent_runs      (id, task_id, status, max_steps)  VALUES ('demo-run-2','demo-task-2','COMPLETED',10);
INSERT INTO artifacts       (id, project_id, file_path, status) VALUES ('demo-art-2','demo-prj','src/j.ts','PENDING_REVIEW');
INSERT INTO changes         (id, artifact_id, agent_run_id, change_type, status, content_hash, diff_summary)
     VALUES ('demo-chg-2','demo-art-2','demo-run-2','CREATED','VERIFIED','h','demo diff 2');
INSERT INTO assessments     (id, artifact_id, change_id, risk_score, impact_score, novelty_score,
                             complexity_score, confidence_score, combined_priority, label, factors_unavailable)
     VALUES ('demo-ass-2','demo-art-2','demo-chg-2',0.1,0.1,0.1,0.1,0.1,0.1,'LOW','{}');
INSERT INTO review_queue    (id, task_id, assessment_id, action, policy_version, rule_id, position, status)
     VALUES ('demo-q-2','demo-task-2','demo-ass-2','AUTO_APPROVABLE',1,'r5-low',1,'QUEUED');
SQL
```

The routed event fires the executor; with calibration green + flag on + under the
bar, it writes the machine decision — **`actor_id IS NULL`** (no human acted),
`dataset_id` back-linked to the green fit:

```bash
psql "$DATABASE_URL" -c "SELECT decision, actor_id, actor_email, sample, dataset_id
                          FROM decisions WHERE change_id = 'demo-chg-2';"
#    decision     | actor_id | actor_email | sample | dataset_id
#   AUTO_APPROVED |  NULL    |  NULL       | false  | ds-green
```

### 3.3 Kill-switch re-opens an in-flight item to a human

With a third item still `AUTO_APPROVABLE`/`QUEUED`, an ADMIN trips the kill-switch:

```bash
curl -s -b /tmp/harness.jar -X POST http://localhost:3000/api/admin/auto-approve/kill \
  -H 'content-type: application/json' -d '{"reason":"calibration red flag"}' | jq .
#   { "ok": true, "killed": true }
```

The one UPDATE both disables auto-approve *and* requeues every in-flight
`AUTO_APPROVABLE` item to a human (rule `kill-switch-requeue`, action flipped to
`REVIEW_REQUIRED`) — and a subsequent auto-approve attempt is denied as tripped:

```bash
psql "$DATABASE_URL" -c "SELECT action, rule_id, status FROM review_queue
                          WHERE action = 'REVIEW_REQUIRED' ORDER BY created_at DESC;"   # kill-switch-requeue
psql "$DATABASE_URL" -c "SELECT auto_approve_enabled, enabled, reason
                          FROM auto_approve_kill_switch WHERE id = 'singleton';"        # false | false | …
```

---

## Leave the system in its safe default

Acceptance criterion: auto-approve **disabled**, kill-switch **armed** at end of day.

```bash
# flag off (no-op if already off), and re-arm the switch (enabled = true)
curl -s -b /tmp/harness.jar -X POST http://localhost:3000/api/admin/auto-approve/enabled \
  -H 'content-type: application/json' -d '{"enabled":false}' | jq .
psql "$DATABASE_URL" -c "UPDATE auto_approve_kill_switch
                          SET enabled = true, killed_at = NULL, killed_by = NULL, reason = NULL
                          WHERE id = 'singleton';"

psql "$DATABASE_URL" -c "SELECT auto_approve_enabled AS flag, enabled AS switch
                          FROM auto_approve_kill_switch WHERE id = 'singleton';"
#   flag | switch
#   -----+-------
#   f    | t
```

## Green gate before you leave Week 3

```bash
pnpm lint && pnpm -r typecheck && pnpm -r test
```