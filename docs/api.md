# API Reference

> **Source of truth:** `apps/api/src/app.ts:127` (10 route groups) + `apps/api/src/routes/*.ts`. This doc mirrors the code; if they diverge, the code wins.
>
> **Auth:** every route under `/api/*` is behind `requireRole` (`packages/auth/src/require-role.ts`). Unauthenticated → `401`, wrong role → `403` (`authz.decision_denied` in `event_log`). See `docs/runbook/users-permissions.md` for the role hierarchy.

Base URL: `http://localhost:3000` (or `APP_URL`). All request/response bodies are JSON. The web UI talks to the API via Vite proxy (`/api` → `:3000`); the `sid` httpOnly cookie is the session credential.

## Route groups

| # | Group | File | Prefix | Purpose |
|---|---|---|---|---|
| 1 | `auth` | `routes/auth.ts` | `/api/auth` | OIDC login / session / logout |
| 2 | `reviews` | `routes/reviews.ts` | `/api/reviews` | Review slice — ingest, list, detail, decision, retry |
| 3 | `review` | `routes/review.ts` | `/api/review` | Review queue (claim/decide/drop/release/escalate) |
| 4 | `provenance` | `routes/provenance.ts` | `/api/tasks/:id/provenance` | 7-section causal trail for a task |
| 5 | `audit` | `routes/audit.ts` | `/api/audit` | Paginated timeline over events + LLM calls + tool calls |
| 6 | `ops` | `routes/ops.ts` | `/api/ops` | Health + metrics gauges |
| 7 | `metrics` | `routes/metrics.ts` | `GET /metrics` | Prometheus exposition (unauthenticated, scraped by monitoring) |
| 8 | `admin` | `routes/admin.ts` | `/api/admin` | Auto-approve flag + kill-switch |
| 9 | `settings` | `routes/settings.ts` | `/api/settings` | Provider registry (MCP) display mirror |
| 10 | `learning` | `routes/learning.ts` | `/api/learning` | Learning-loop cycle audit |
| — | `triage-rules` | `routes/triage-rules.ts` | `/api/triage-rules` | Review-mode + triage rule toggles |

Health probe (no auth): `GET /health → { status: "ok" }`

---

## 1. Auth — `routes/auth.ts`

| Method | Path | Auth | Request | Response | Notes |
|---|---|---|---|---|---|
| `GET` | `/api/auth/login` | none | — | `302 Location: <IdP authorization URL>` | Creates `state` + PKCE `code_verifier` in `pendingLogins` map (TTL 10 min, `auth.ts:29`) |
| `GET` | `/api/auth/callback?code=&state=` | none | query `code`, `state` | `{ token, user: { id, sub, email, roles } }` + `Set-Cookie: sid=...; HttpOnly` | Exchanges code, upserts user on `oidc_sub`, creates session |
| `GET` | `/api/auth/session` | cookie `sid` | — | `{ user: { id, sub, email, displayName, roles }, sid }` | 401 if unauthenticated |
| `POST` | `/api/auth/logout` | cookie `sid` | — | `{ ok: true }` | Revokes session row + clears cookie |

With `OIDC_MOCK=true` (dev default): `GET /api/auth/login` redirects to self-callback immediately (no external IdP).

---

## 2. Reviews (review slice) — `routes/reviews.ts`

### `POST /api/reviews` — ingest a PR for AI review

- **Auth:** `Operate | Reviewer | Admin`
- **Rate limit:** 10 req/min per IP (`app.ts:31`, in-process; 429 when exceeded)
- **Request:**
  ```json
  { "prUrl": "https://github.com/org/repo/pull/123", "jiraTicket": "ACME-42" }
  ```
  `prUrl` required; `jiraTicket` optional. When `triage-rules.autoReviewEnabled` is ON, `autoReviewMode: true` is injected automatically.
- **Success:** `202 Accepted`
  ```json
  { "reportId": "rpt_...", "taskId": "tsk_...", "prUrl": "...", "status": "pending" }
  ```
  A `review.requested` event is published; `ReviewWorkerSubscriber` processes it asynchronously. Poll `GET /api/reviews/:id` for `review_status` + `batch_progress`.
- **Errors:** `400` missing/invalid URL, `404` PR not found, `422` repo not accessible (bad `GITHUB_TOKEN`), `502` Git host unreachable.

### `GET /api/reviews?pending=&limit=&offset=`

- **Auth:** `Operate | Reviewer | Admin`
- **Query:** `pending=1` keeps only not-yet-decided; `limit` (default 20, max 100), `offset` (default 0)
- **Response:** `Array<{ id, prUrl, prNumber, repo, prTitle, overallVerdict, effectiveVerdict, createdAt, decided, decision, findingCount, author, branch, additions, deletions, filesChanged, riskScore, priority, criticalFindings, findings: [{severity,kind,file,line,message}], triage }>` ordered `created_at DESC`.

### `GET /api/reviews/summary`

- **Auth:** `Operate | Reviewer | Admin`
- **Response:** `{ pendingCount, decidedCount, approvedCount }` — two aggregate queries, not a full table scan.

### `GET /api/reviews/:id`

- **Auth:** `Operate | Reviewer | Admin`
- **Response:**
  ```json
  {
    "id": "rpt_...", "prUrl": "...", "prNumber": 123, "repo": "org/repo",
    "aiProvider": "custom", "model": "gpt-4.1",
    "summary": "...", "overallVerdict": "COMMENT",
    "reviewStatus": "complete", "batchProgress": null,
    "effectiveVerdict": "COMMENT",
    "triage": { "securityBlocked": false, "regressionRisk": false, "matchedRules": [] },
    "writeback": { "enabled": true },
    "stats": { "flaggedFiles": 2, "totalFiles": 12, "...": "..." },
    "findings": [{ "id": "...", "severity": "CRITICAL", "kind": "correctness", "file": "...", "line": 42, "anchor": "...", "message": "...", "orderIndex": 0 }],
    "suggestions": [{ "id": "...", "file": "...", "hunk": "...", "proposed": "..." }],
    "diff": [{ "file": "...", "patch": "..." }],
    "trace": { "calls": [{ "model": "...", "inputTokens": 0, "outputTokens": 0, "stopReason": "..." }], "judge": [] },
    "decisions": [{ "id": "...", "decision": "APPROVE", "rationale": "...", "writebackEnabled": true }],
    "writebacks": [{ "id": "...", "provider": "github", "action": "comment", "status": "SUCCEEDED" }],
    "verification": { "status": "PASSED", "overall": "PASSED", "failedKinds": [], "failedChecks": [], "rendered": "..." },
    "recalledMemories": null
  }
  ```
  `verification` is `null` when no `review_verifications` row exists (pre-wedge reports or `VERIFY_REVIEW_ENABLED=0`). `writeback.enabled` reflects the server's current `WRITEBACK_ENABLED` ceiling.

### `POST /api/reviews/auto`

- **Auth:** `Operate | Reviewer | Admin`
- **Request:** same `CreateReviewBody` as `POST /api/reviews`
- **Guard:** `400` if `triage-rules.autoReviewEnabled` is OFF — enable it via `POST /api/triage-rules` first.
- **Behaviour:** synchronous (no `202`); returns `{ reportId, prUrl, summary, overallVerdict, findings, suggestions }` with **all** severities (CRITICAL→INFO). For the async flow use `POST /api/reviews`.

### `POST /api/reviews/:id/decision`

- **Auth:** `Reviewer | Admin` only
- **Request:**
  ```json
  { "decision": "APPROVE | REQUEST_CHANGES | REJECT", "rationale": "optional but audited", "writeback": true, "comment": "optional PR comment override" }
  ```
  `decision` required; `writeback` defaults via `writebackEnabled()` (OFF if `WRITEBACK_ENABLED=0` or per-provider flag OFF).
- **Effect:**
  1. Inserts `review_decisions` row (`writeback_enabled` = effective gate).
  2. Publishes `ReviewDecisionSubmitted` (so `MemoryIngestor` distills a DECISION entry regardless of write-back).
  3. If `effective && decision ∈ {APPROVE, REJECT}` → `WriteBackService.write` COMMENT + STATUS via MCP; `REQUEST_CHANGES` never writes (even with toggle ON).
  4. `REJECT` write-back comment includes full findings + suggestions via `formatRejectWritebackBody`.
- **Response:** `{ reportId, decision, decisionId, writeback: { comment, status } | false | { emitted: 0, reason } }`. Write-back failure → `422` with `WriteBackError` message.
- **Audit:** every write lands in `writeback_log` (`dedup_key` partial index enforces one external write per decision). OFF is an auditable `writeback_enabled=false` row, not an absence.

### `POST /api/reviews/:id/retry`

- **Auth:** `Operate | Reviewer | Admin`
- **Guard:** only when `review_status === 'error'` — else `400`.
- **Effect:** deletes stale `review_findings`/`fix_suggestions`, resets `review_status='pending'` + `summary=''`, re-publishes `review.requested`.
- **Response:** `202 { reportId, status: "pending" }`

---

## 3. Review queue — `routes/review.ts`

> The Day-22 queue surface (`review_queue` table). All mutating routes require `Reviewer | Admin`; identity is `request.auth.user` (never a body `reviewerId`).

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/api/review/queue?status=` | `Reviewer\|Admin` | — | `ReviewService.listQueue(status)` — filtered queue rows |
| `GET` | `/api/review/queue/:id` | `Operate\|Reviewer\|Admin` | — | Queue item detail |
| `GET` | `/api/review/evidence/:id` | `Reviewer\|Admin` | — | Evidence blob for a queue item |
| `POST` | `/api/review/queue/:id/claim` | `Reviewer\|Admin` | — | Claims item for `request.auth.user` |
| `POST` | `/api/review/queue/:id/decide` | `Reviewer\|Admin` | `{ decision, rationale, wasUseful, comment? }` | Decision + `wasUseful` feedback |
| `POST` | `/api/review/queue/:id/drop` | `Reviewer\|Admin` | `{ rationale }` | `{ ok: true }` |
| `POST` | `/api/review/queue/:id/release` | `Reviewer\|Admin` | — | `{ ok: true }` — releases claim |
| `POST` | `/api/review/queue/:id/escalate` | `Reviewer\|Admin` | `{ rationale }` | Escalates to human review |

Error mapping (`review.ts:49`): `QueueItemNotFoundError`/`EvidenceNotFoundError` → 404, `QueueConflictError`/`QueueStateError`/`IllegalTransitionError` → 409, `MissingRationaleError` → 400.

---

## 4. Provenance / Audit / Ops

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/tasks/:id/provenance` | none (public read) | `buildProvenanceChain` — 7-section trail; 404 if task not found |
| `GET` | `/api/audit?limit=&before=&kind=&eventType=` | `Reviewer\|Admin` | Paginated timeline over `event_log` + `llm_call_log` + `trajectory_steps` + `agent_runs`, merged newest-first. `limit` default 100 max 500; `before` cursor; `kind` ∈ `event\|llm\|tool\|run` |
| `GET` | `/api/ops/health` | none | Single `SELECT 1` probe → `{ ok: true }` or 500 |
| `GET` | `/api/ops/metrics` | none | `{ tasksByState, reviewQueueDepth, orphanedTasks }` — gauges for the runbook |
| `GET` | `/metrics` | none | Prometheus exposition (scraped by `prometheus.yml`) |

Trace propagation: `trace.ts` `registerTraceHook` wraps every request in an `http.request` span; `trace_correlation` maps span → `event_log`.

---

## 5. Admin / Settings / Learning / Triage

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/admin/auto-approve/enabled` | `Admin` | `{ enabled: boolean }` | `{ autoApproveEnabled }` — flips singleton flag |
| `POST` | `/api/admin/auto-approve/kill` | `Admin` | `{ reason: string }` | `{ ok, killed }` — disables flag + requeues `AUTO_APPROVABLE` |
| `GET` | `/api/settings/providers` | `Admin` | — | `{ providers: [{ name, kind, providerType, transport, tokenHint, enabled, baseUrl }] }` — `mcp.config.json` truth + `provider_configs` mirror; token never leaves as value, only last-4 hint |
| `PUT` | `/api/settings/providers` | `Admin` | `{ providers: { github: true, jira: false } }` | Same as GET after upsert (unknown provider → 400) |
| `GET` | `/api/learning/cycles?limit=` | `Reviewer\|Admin` | — | Last N `learning.loop_completed` events from `event_log` |
| `GET/POST` | `/api/triage-rules` | `Admin` (POST) / any auth (GET) | `{ autoReviewEnabled, rules: [...] }` | Triage gate state (high-signal vs full-review mode + `text.md` injection) |

Triage rules live in `triage-rules` table; `ReviewIngestService` reads `loadTriageRuleState(db)` on every ingest so POST takes effect immediately.

---

## 6. Error contract

All routes use a global handler (`app.ts:107`): `{ error: string, stack?: string }` (stack only when `NODE_ENV !== production`). Domain errors are mapped to `400/404/409/422` per route; unhandled → `500 internal_server_error`. Rate-limit exceeded → `429`.

## Related docs

- `docs/runbook/users-permissions.md` — permission matrix for every route
- `docs/runbook/audit-queries.md` — Q1–Q9 SQL behind `/api/audit`
- `docs/env.md` — env vars that change route behaviour (writeback, verification, AI budget)
- `e2e/README.md` — how `pnpm e2e` drives these routes through the real graph
