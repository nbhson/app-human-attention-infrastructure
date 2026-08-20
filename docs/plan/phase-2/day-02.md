# Day 02 — AuthZ: Reviewer Roles, Endpoint Enforcement & Audit Identity

| | |
|---|---|
| **Week** | 1 — Identity & observability |
| **Spec refs** | Architecture §13 (decisions capture who), Spec 9 §3.2 (provenance invariants), Spec 6 §4 (review decisions) |
| **Estimated effort** | 6 hours |
| **Prerequisites** | Day 01 (users + sessions + JWT; `@harness/auth` and `/api/auth/*`) |

---

## 1. Objectives

By end of day you will have:

1. **Role enforcement** — `REVIEWER` (and `ADMIN`) gates on every review/decision endpoint; `OPERATOR` can read but cannot claim, decide, or approve.
2. **Identity on the audit trail** — every authenticated action writes the acting user's id/email to the audit/log surface, not just the event payload.
3. **The `X-Reviewer-Id` header retired** — it is removed from the codebase, not merely ignored.
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

Rules are **additive** (ADMIN ⊇ REVIEWER ⊇ OPERATOR). Assign the minimum role that unblocks the work; the Day-30 backlog may add per-project reviewer scopes, but not this phase.

### 2.2 Enforcement point — a single `requireRole` guard, one call site per route

Role checks live in `@harness/auth` and are composed in `apps/api` middleware, **not** scattered through the review package. The `review` package stays identity-agnostic: it continues to receive an explicit `reviewerId`, but that value now comes from the authenticated principal, never from a header or a request body.

```typescript
// packages/auth/src/require-role.ts
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.auth;                       // populated by Day-01 onRequest hook
    if (!ctx) throw new UnauthenticatedError();
    if (!roles.some(r => ctx.user.roles.includes(r))) {
      await auditDenied(req, ctx, roles);       // emit authz.decision_denied (§2.3)
      throw new ForbiddenError(ctx.user.id, roles);
    }
  };
}
```

Wiring on the review routes (Phase-1 endpoints, now guarded):

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

- `review_decisions.actor_id` replaces the Phase-1 free-form `reviewer_id` string as the FK to `users`. Backfill: existing rows keep their legacy `reviewer_id`; new decisions write `actor_id` (and `actor_email` as a denormalised convenience for reporting).
- `event_log.actor_id` is set on every event published while a request has an auth context (populated in the Fastify hook). It is **not** part of the event payload — it is envelope metadata, so downstream consumers don't have to know about auth.
- `authz.decision_denied` — `{ actorId, resource, rolesRequired }` — is published by the guard on every 403 so a denial is queryable from the event log (anchors the Week-2 "who can't do what" report).

### 2.4 The `review.decision_submitted` payload stays the same

Phase-1 downstream consumers (`ChangeStatusSubscriber`, `reportAssessmentFeedback`) key off `taskId` and `decision`. Today's change is additive — add `actorId` to the payload without removing `reviewerId` — so no consumer breaks. Enforce with the existing event-version discipline (bump to `event_version: 2` on `review.decision_submitted`).

---

## 3. Tasks

### 3.1 Migration + backfill (45 min)

- [ ] `packages/db/migrations/0102_authz.sql` — `actor_id`/`actor_email` on `review_decisions`; `actor_id` on `event_log`.
- [ ] Backfill script (`scripts/backfill-actors.ts`): for legacy rows, attempt to map old `reviewer_id` strings to `users` where an email matches; leave others `NULL` (honest null, not a fake join).

### 3.2 Implement `requireRole` + `ForbiddenError` (60 min)

- [ ] `packages/auth/src/require-role.ts` (as §2.2) with `auditDenied` publishing `authz.decision_denied`.
- [ ] `packages/auth/src/errors.ts` — add `ForbiddenError` (carries `userId`, `requiredRoles`).

### 3.3 Wire guards into `apps/api` + kill the header (90 min)

- [ ] Guard every route in §2.2's table; propagate `req.auth.user.id` as `reviewerId` into review-service calls.
- [ ] Remove the `X-Reviewer-Id` fallback branch; `grep -r 'X-Reviewer-Id' apps packages` returns zero.
- [ ] Set `event_log.actor_id` in the Fastify `onResponse`/`onSend` path from `req.auth`.

### 3.4 Publish `reviewerId → actorId` on decision (45 min)

- [ ] Update `packages/review/src/decide.ts` to write `actor_id`/`actor_email` and pass `actorId` in the event payload (event_version 2).

### 3.5 Tests (120 min)

- [ ] `packages/auth/src/__tests__/require-role.test.ts`:
  - OPERATOR on `decide` → 403 and an `authz.decision_denied` event is published (spy).
  - REVIEWER on `decide` → allowed; `review_decisions.actor_id` written.
  - Unauthenticated request → 401 (not 403).
- [ ] `apps/api` integration: two reviewers, one item, both `claim` — second still gets 409 (Day-22 behavior preserved) but both 200/409s now carry `actor_id`.
- [ ] `grep -r 'X-Reviewer-Id' apps packages` — zero hits (asserted in a tiny test or script).

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

- [ ] `pnpm --filter @harness/auth test` — role matrix tests pass (401 vs 403 vs allowed).
- [ ] `pnpm --filter @harness/review test` — decision flow still green with `actor_id` populated.
- [ ] `grep -r "X-Reviewer-Id" apps packages` — zero results (header fully retired).
- [ ] A denied decision (OPERATOR) produces both an HTTP 403 **and** an `authz.decision_denied` row in `event_log`.
- [ ] After a REVIEWER approves: `SELECT actor_id, actor_email FROM review_decisions` returns the real user, and `event_log.actor_id` is non-null for that task's events.
- [ ] Legacy rows: backfill leaves jobs it cannot map with `actor_id = NULL` (auditable, not guessed).
- [ ] `pnpm lint` — zero boundary violations; `grep -r "from '@harness" packages/auth/src` shows only domain/db/di.

---

## 6. Notes & Pitfalls

- **Authorization is not authentication.** `requireRole` assumes the request reached an `onRequest` hook that already populated `req.auth`. If the hook is missing, the guard must throw *unauthenticated*, not silently pass — test the unauthenticated path explicitly.
- **Denial events are evidence, not spam.** Rate of `authz.decision_denied` is itself a metric (Day 04's counter). Guard against actors treating 403s as a probe — log the denial once, don't retry on it.
- **Don't trust `reviewer_id` from the request body anymore.** Any leftover code reading a body-supplied `reviewer_id` is an impersonation bug. Grep for `reviewerId` in route handlers and make sure it is sourced only from `req.auth`.
- **`actor_email` on the row is a denormalisation.** It is for week-2 reporting joins; the *authoritative* identity is `actor_id` → `users`. A user who later changes email must not rewrite history — hence the backfill-keeps-nulls rule.
- **Next (Day 03):** OpenTelemetry spans across API/orchestrator/engines, with `trace_id ↔ correlation_id` so an audit row links to a trace.

---

*Prev: [Day 1 — AuthN: OIDC SSO, Session/JWT & User Identity Model](day-01.md) | Next: [Day 3 — OpenTelemetry: Spans, trace_id ↔ correlation_id](day-03.md)*
