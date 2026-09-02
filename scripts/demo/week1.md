# Week 1 Live Demo — Identity & Observability

_Phase 2 · day-05 checkpoint. A narrated runbook: run the commands on a clean
stack and the whole Week-1 milestone (SSO login → role enforcement → a traced,
decision → /metrics) plays out in front of you. Every endpoint, table and metric
below is the real code path — nothing is faked into a cookie that skips the
mock OIDC exchange (`day-01 §3.5`)._

> The one non-interactive step is a small SQL **fixture** that primes one
> decidable review-queue item (task → change → assessment → queue). It mirrors
> exactly what the review-routes integration test seeds
> (`apps/api/src/__tests__/review-routes.test.ts#seedQueuedItem`), so the demo
> isn't exercising a scripted happy path — it's exercising a real reviewer
> decision over real rows. Identity itself is never simulated: the mock provider
> still runs the full authorization-code redirect.

---

## 0. Prereqs & clean stack

```bash
docker compose down -v        # fresh postgres (the only docker service)
docker compose up -d          # wait for postgres healthy

pnpm --filter @harness/db migrate   # apply migrations to the fresh DB
pnpm dev                      # API on http://localhost:3000
```

Mock identity is enabled in-process (no separate IdP container — the mock OIDC
provider _is_ the exchange, see `packages/auth/src/oidc/mock-provider.ts`):

```bash
OIDC_MOCK=true \
MOCK_OIDC_SUB='operator@demo' \
MOCK_OIDC_EMAIL='operator@example.com' \
MOCK_OIDC_NAME='Demo Operator' \
  pnpm dev
```

---

## 1. Login — real mock OIDC redirect → session cookie

```bash
# (i) hit the login route; it 302s to the mock IdP authorization URL
curl -i -s http://localhost:3000/api/auth/login -c /tmp/harness.jar
#   HTTP/1.1 302 Found
#   Location: http://localhost:3000/api/auth/callback?code=mock-code-1&state=<STATE>&...

# (ii) "complete the redirect": follow the Location with the same cookie jar.
#      The mock provider trusts the code it issued; the app exchanges it, upserts
#      the user keyed on oidc_sub, mints a session row and sets the httpOnly `sid`
#      cookie. No fake cookie skips this exchange.
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' http://localhost:3000/api/auth/login)
curl -s -b /tmp/harness.jar -c /tmp/harness.jar "$LOC" | jq .
#   { "token": "<jwt>", "user": { "id": "...", "sub": "operator@demo", ... } }

# (iii) the session endpoint reflects the live principal
curl -s -b /tmp/harness.jar http://localhost:3000/api/auth/session | jq .user
#   { "sub": "operator@demo", "email": "operator@example.com", "roles": ["OPERATOR"] }
```

**Beat:** first sight grants `DEFAULT_ROLES = [OPERATOR]` (`domain/src/identity.ts`).
Roles are additive `ADMIN ⊇ REVIEWER ⊇ OPERATOR` — so this principal _cannot
review_ yet. That is exactly the precondition for beat 2.

---

## 2. AuthZ — OPERATOR refused, REVIEWER accepted

Prime one decidable item (the fixture SQL, lifted from the review-routes test):

```bash
psql "${DATABASE_URL:-postgres://harness:harness@localhost:5432/harness}" <<'SQL'
INSERT INTO projects            (id, name, repo_path)             VALUES ('demo-prj','demo-ng', 'fixtures/demo');
INSERT INTO tasks               (id, project_id, title, state, idempotency_key)
     VALUES ('demo-task','demo-prj','Demo change awaiting review','AWAITING_REVIEW','demo-ik');
INSERT INTO agent_runs          (id, task_id, status, max_steps)  VALUES ('demo-run','demo-task','COMPLETED',10);
INSERT INTO artifacts           (id, project_id, file_path, status) VALUES ('demo-art','demo-prj','src/index.ts','PENDING_REVIEW');
INSERT INTO changes             (id, artifact_id, agent_run_id, change_type, status, content_hash, diff_summary)
     VALUES ('demo-chg','demo-art','demo-run','CREATED','VERIFIED','h','demo diff');
INSERT INTO assessments         (id, artifact_id, change_id, risk_score, impact_score, novelty_score,
                                 complexity_score, confidence_score, combined_priority, label, factors_unavailable)
     VALUES ('demo-ass','demo-art','demo-chg',0.5,0.5,0.5,0.4,0.6,0.6,'HIGH','{}');
INSERT INTO review_queue        (id, task_id, assessment_id, action, policy_version, rule_id, position, status)
     VALUES ('demo-q','demo-task','demo-ass','REVIEW_REQUIRED',1,'r1',1,'QUEUED');
SQL
```

**As the OPERATOR** — the guard is `requireRole(REVIEWER, ADMIN)`:

```bash
curl -s -b /tmp/harness.jar -X POST http://localhost:3000/api/review/queue/demo-q/claim \
  -H 'content-type: application/json' -d '{}'
#   HTTP/1.1 403  { "error": "insufficient role for this action" }
```

And the refusal is not silent — the guard published `authz.decision_denied`,
which `EventLogWriter` (subscribed to **every** event type) persisted:

```bash
psql "$DATABASE_URL" -c "SELECT event_type, correlation_id, actor_id
                          FROM event_log
                          WHERE event_type = 'authz.decision_denied'
                          ORDER BY occurred_at DESC LIMIT 1;"
```

**As the REVIEWER** — seed that same user a reviewer role, then log back in
through the mock:

```bash
psql "$DATABASE_URL" -c "UPDATE users SET roles = '{\"OPERATOR\",\"REVIEWER\"}'
                          WHERE oidc_sub = 'operator@demo';"

# restart dev with a reviewer identity, repeat beat (ii) to get its cookie
curl -s -b /tmp/harness.jar -X POST http://localhost:3000/api/review/queue/demo-q/claim \
  -H 'content-type: application/json' -d '{}' | jq .id          # 200 → claimed

curl -s -b /tmp/harness.jar -X POST http://localhost:3000/api/review/queue/demo-q/decide \
  -H 'content-type: application/json' \
  -d '{"decision":"APPROVE","rationale":"lgtm","wasUseful":true}' | jq '.status'
#   "DECIDED"
```

---

## 3. Trace — `trace_id ↔ correlation_id` on the decision

The decide ran inside a `review.decide` span whose correlation is the task id;
on root-span completion the correlator wrote the reverse-mapping row
(`packages/db/src/schema/trace-correlation.ts`):

```bash
psql "$DATABASE_URL" -c "SELECT trace_id, span_id
                          FROM trace_correlation
                          WHERE correlation_id = 'demo-task'
                          ORDER BY started_at DESC LIMIT 1;"
#     trace_id  |              span_id
#   ------------+--------------------------------
#   32-hex-...  | 16-hex-...

# reverse lookup works from either side
psql "$DATABASE_URL" -c "SELECT correlation_id FROM trace_correlation
                          WHERE trace_id = :'T' ;" -v T="<trace_id>"
```

If the row is missing here, some span escaped the async-local correlation and
defaulted to `bootstrap` — that is the Week-1 fragility the retro names; find it
now, while it's cheap.

---

## 4. Metrics — `/metrics` shows the decision

The same decide observed dwell and usefulness counters
(`packages/observability/src/metrics.ts`); the API serves the Prometheus text
scrape:

```bash
curl -s http://localhost:3000/metrics | grep -E 'harness_(routing_items_total|review_dwell_seconds|assessment_usefulness_total)'
#   harness_routing_items_total{route="human"} 1
#   harness_review_dwell_seconds_bucket{le="...",} ...
#   harness_assessment_usefulness_total{was_useful="true"} 1
```

There is no bundled Grafana — the metrics above are Prometheus text format. Point
your own scraper at `/metrics` to build the routing funnel, usefulness ratio, and
dwell distribution over the scrape interval.

---

## Green gate before you leave Week 1

```bash
pnpm lint && pnpm -r typecheck && pnpm -r test && pnpm e2e
grep -r "X-Reviewer-Id" apps packages   # must print nothing
```
