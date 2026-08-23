# Day 02 — AuthZ: Reviewer Roles, Endpoint Enforcement & Audit Identity

| | |
|---|---|
| **Week** | W1 — Identity & observability |
| **Spec refs** | Architecture §13 (decisions capture who), Spec 9 §3.2 (provenance invariants), Spec 6 §4 (review decisions) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 01 (users + sessions + JWT; `@harness/auth` and `/api/auth/*`) |

---

## 1. Objectives

By end of day you will have:

1. **Role enforcement** — `REVIEWER` (and `ADMIN`) gates on every review/decision endpoint; `OPERATOR` can read but cannot claim, decide, or approve.
2. **Identity on the audit trail** — every authenticated action writes the acting user's id/email to the audit/log surface.
3. **The `X-Reviewer-Id` header retired** — removed from the codebase, not merely ignored.
4. An **authz denial audit event** (`authz.decision_denied`) so a rejected attempt is itself evidence, not a silent 403.

Why this matters: Phase 1 built the review loop with `reviewerId = 'reviewer-1'` as a demo placeholder. The metric shop opens in Week 2, and every routing/usefulness metric assumes decisions are attributed to a **real, authenticated principal**. A usefulness counter keyed to a fake ID is noise.

---

## 2. Design Decisions

### 2.1 Role model (three roles, additive)

| Role | Read queue | Claim / decide / approve | Manage users / policies / flags |
|------|-----------|---------------------------|--------------------------------|
| `OPERATOR` | ✅ | ❌ | ❌ |
| `REVIEWER` | ✅ | ✅ | ❌ |
| `ADMIN` | ✅ | ✅ | ✅ (auto-approve flag, thresholds, reports) |

Rules are **additive** (ADMIN ⊇ REVIEWER ⊇ OPERATOR). Assign the minimum role that unblocks the work.

### 2.2 Enforcement point — a single `requireRole` guard

Role checks live in `@harness/auth` and are composed in `apps/api` middleware, **not** scattered through the review package. `@harness/review` stays identity-agnostic: it receives an explicit `reviewerId`, but that value now comes from the authenticated principal, never from a header or request body.

| Route | Guard |
|-------|-------|
| `GET /api/review/queue` | `requireRole('REVIEWER','ADMIN')` |
| `POST /api/review/queue/:id/claim` | `requireRole('REVIEWER','ADMIN')` |
| `POST /api/review/queue/:id/decide` | `requireRole('REVIEWER','ADMIN')` |
| `POST /api/tasks/:id/approve` / `reject` | `requireRole('REVIEWER','ADMIN')` |
| `GET /api/review/queue/:id` | `requireRole('OPERATOR','REVIEWER','ADMIN')` (read-only) |

`ADMIN`-only surface arrives on Day 14 (auto-approve flag) — today we land the guard so Day 14 flips a flag, not a whole authz story.

### 2.3 Audit identity — two columns + one event

```sql
-- packages/db/migrations/0102_authz.sql
ALTER TABLE review_decisions ADD COLUMN actor_id   text REFERENCES users(id);
ALTER TABLE review_decisions ADD COLUMN actor_email text;
ALTER TABLE event_log      ADD COLUMN actor_id     text REFERENCES users(id);
```

`actor_id` replaces the Phase-1 free-form `reviewer_id` as the FK to `users` (backfill best-effort, honest `NULL` where unmappable). `event_log.actor_id` is envelope metadata (not the event payload). `authz.decision_denied` publishes `{ actorId, resource, rolesRequired }` on every 403 so denials are queryable.

### 2.4 `review.decision_submitted` stays backward-compatible

Downstream consumers key off `taskId` and `decision`. Add `actorId` without removing `reviewerId`; bump `event_version: 2`.

---

## 3. Tasks

### 3.1 Migration + backfill (45 min)
- [ ] `packages/db/migrations/0102_authz.sql` — actor columns on `review_decisions` + `event_log`.
- [ ] `scripts/backfill-actors.ts` — map legacy `reviewer_id` → `users` where email matches; leave the rest NULL.

### 3.2 Implement `requireRole` + `ForbiddenError` (60 min)
- [ ] `packages/auth/src/require-role.ts` — guard + `auditDenied` publishing `authz.decision_denied`.
- [ ] `packages/auth/src/errors.ts` — `ForbiddenError(userId, requiredRoles)`.

### 3.3 Wire guards + kill the header (90 min)
- [ ] Guard routes in §2.2; propagate `req.auth.user.id` as `reviewerId`.
- [ ] Remove the `X-Reviewer-Id` fallback; `grep -r 'X-Reviewer-Id' apps packages` → zero.
- [ ] Set `event_log.actor_id` in the Fastify response path from `req.auth`.

### 3.4 Publish `reviewerId → actorId` on decision (45 min)
- [ ] `packages/review/src/decide.ts` writes `actor_id`/`actor_email`; event payload carries `actorId` (event_version 2).

### 3.5 Tests (120 min)
- [ ] OPERATOR on `decide` → 403 + `authz.decision_denied` published (spy).
- [ ] REVIEWER on `decide` → allowed; `review_decisions.actor_id` written.
- [ ] Unauthenticated → 401 (not 403).
- [ ] Two reviewers claim the same item → second still 409, both now carrying `actor_id`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/migrations/0102_authz.sql` | actor columns on `review_decisions`, `event_log` |
| `packages/auth/src/require-role.ts` | `requireRole` guard + `auditDenied` |
| `packages/auth/src/errors.ts` (updated) | `ForbiddenError` |
| `apps/api/src/routes/*` (updated) | guards wired + `X-Reviewer-Id` removed |
| `packages/review/src/decide.ts` (updated) | `actor_id` on decisions + event_version 2 |
| `scripts/backfill-actors.ts` | legacy `reviewer_id` → `actor_id` (best-effort) |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/auth test` — role matrix passes (401 vs 403 vs allowed).
- [ ] `pnpm --filter @harness/review test` — decision flow green with `actor_id` populated.
- [ ] `grep -r "X-Reviewer-Id" apps packages` — zero results.
- [ ] A denied decision produces both HTTP 403 **and** an `authz.decision_denied` row in `event_log`.
- [ ] After a REVIEWER approves: `actor_id`/`actor_email` return the real user; `event_log.actor_id` non-null for that task.
- [ ] Backfill leaves unmappable legacy rows with `actor_id = NULL` (auditable, not guessed).
- [ ] `grep -r "from '@harness" packages/auth/src` shows only domain/db/di.

---

## 6. Notes & Pitfalls

- **Authorization is not authentication.** `requireRole` assumes `req.auth` is populated by Day-01's hook; if missing, throw *unauthenticated*, never silently pass.
- **Denial events are evidence, not spam.** Denial rate is itself a metric (Day 04); log the denial once, don't retry on it.
- **Don't trust `reviewer_id` from the request body anymore.** Any leftover body-supplied `reviewer_id` is an impersonation bug.
- **`actor_email` is denormalized convenience.** The authoritative identity is `actor_id` → `users`; a changed email must not rewrite history.
- **Next (Day 03):** OpenTelemetry spans across API/engines, with `trace_id ↔ correlation_id`.

---

*Prev: [Day 01 — AuthN: OIDC SSO Login, Session/JWT & User Identity Model](day-01.md) | Next: [Day 03 — OpenTelemetry: Spans, trace_id ↔ correlation_id](day-03.md)*