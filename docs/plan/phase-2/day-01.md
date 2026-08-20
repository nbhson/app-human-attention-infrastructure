# Day 01 — AuthN: OIDC SSO, Session/JWT & User Identity Model

| | |
|---|---|
| **Week** | 1 — Identity & observability |
| **Spec refs** | Architecture §13 (human decision capture), Spec 9 §3.1 (`humanId: ReviewerId`), Phase-1 day-30 backlog P0 (real authn) |
| **Estimated effort** | 7–8 hours |
| **Prerequisites** | Phase 1 complete — `v0.1.0-harness` tagged; `event_log`, `review_decisions`, and the evidence store are live and queryable |

---

## 1. Objectives

By end of day you will have:

1. A **user identity model** — a `User` domain type plus a `users` table keyed by an OIDC `sub` (the subject identifier from the identity provider), never by a mutable email.
2. An **OIDC login flow** (Authorization Code + PKCE) behind a real provider adapter, replacing the Phase-1 `X-Reviewer-Id` header as the source of identity.
3. A **session/JWT layer** — a short-lived JWT access token plus a server-side `sessions` row so revocation is a DB truth, not a token-format trick.
4. A **new `packages/auth`** package exposing `AuthService` + `SessionService`, wired through DI, with an integration test that logs a user in and validates a token.

This is the first P0 from the Phase-1 backlog. Everything in Phase 2 that claims "real identity on the audit trail" (Day 02, and every metric that follows) depends on today's model being correct: identity is keyed on a provider-stable `sub`, and every authenticated mutation records *who* did it.

---

## 2. Design Decisions

### 2.1 Identity model — `sub` is the key, email is display data

```typescript
// packages/domain/src/identity.ts
export type Role = 'OPERATOR' | 'REVIEWER' | 'ADMIN';

export interface User {
  id:        UserId;          // internal UUIDv7, referenced by other rows (cheap FK)
  oidcSub:   string;          // provider-stable subject (e.g. "auth0|u_abc123") — uniqueness anchor
  email:     string;          // display/preferred email, mutable
  displayName: string;
  roles:     Role[];
  createdAt: Date;
  updatedAt: Date;
}
```

**Why `oidcSub` and not email as the anchor?** Emails get reassigned and renamed; the OIDC `sub` is what the provider guarantees is stable. The audit trail must not change meaning when a user's email does. The internal `id` (UUIDv7) is what other tables FK to, so re-provisioning a user doesn't rewrite history.

```sql
-- packages/db/migrations/0101_auth.sql
CREATE TABLE users (
  id            text PRIMARY KEY,                      -- UUIDv7
  oidc_sub      text NOT NULL UNIQUE,
  email         text NOT NULL,
  display_name  text NOT NULL,
  roles         jsonb NOT NULL DEFAULT '["OPERATOR"]',  -- Phase-1 role; Day 02 adds enforcement
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

### 2.2 Session design — JWT access token + DB-backed session record

Two artifacts, two answers:

| Artifact | Purpose | Lifetime | Revocation |
|----------|---------|----------|------------|
| **JWT access token** | Stateless identity for API calls (`sub`, `roles`, `sid`) | ~15 min | None — short-lived by design |
| **`sessions` row** | The *revocable* truth: logout, role change, compromise | 7 days (rolling) | `revoked_at` is set in one UPDATE |

```sql
CREATE TABLE sessions (
  id          text PRIMARY KEY,                 -- sid embedded in the JWT
  user_id     text NOT NULL REFERENCES users(id),
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz                       -- NULL = active
);

CREATE INDEX sessions_user_idx ON sessions(user_id);
```

Token validation is therefore **two checks, in order**: (1) JWT signature + expiry, (2) the `sessions` row exists and `revoked_at IS NULL`. A leaked signed token is still dead the moment its session is revoked — the DB is the source of truth, never the token format.

### 2.3 OIDC flow — Authorization Code + PKCE, provider behind an adapter

Use `openid-client` (the reference-complete OIDC library) behind a thin `OidcProvider` interface so the harness never hard-codes Keycloak/Auth0/Okta:

```typescript
// packages/auth/src/oidc/provider.ts
export interface OidcProvider {
  getAuthorizationUrl(state: string, codeVerifier: string, redirectUri: string): string;
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenSet>;
  getUserInfo(accessToken: string): Promise<{ sub: string; email: string; name: string }>;
}
```

Callbacks:

1. `GET /api/auth/login` → build `state` (nonce) + `codeVerifier` (PKCE), redirect to IdP.
2. `POST /api/auth/callback` → exchange code, fetch `userInfo`, **upsert `users` on `oidc_sub`**, create `sessions` row, set an httpOnly session cookie containing the `sid`.
3. `GET /api/auth/session` → return current user (for the web UI) or 401.
4. `POST /api/auth/logout` → revoke the session row (and drop the cookie).

### 2.4 Boundary rule — the new `auth` package

`packages/auth` imports **only** `@harness/domain`, `@harness/db`, `@harness/di`. It does not publish or consume harness events — authentication is not a pipeline step. Add this to the ESLint boundaries config and the Day-05 architecture test (R7).

---

## 3. Tasks

### 3.1 Scaffold `packages/auth` + migration (45 min)

- [ ] `packages/auth/package.json` — name `@harness/auth`; deps: `@harness/domain`, `@harness/db`, `@harness/di`, `openid-client`, `jose` (JWT sign/verify).
- [ ] `packages/db/migrations/0101_auth.sql` — `users` + `sessions` (+ index). `pnpm --filter @harness/db generate` → review → `migrate`.
- [ ] `packages/domain/src/identity.ts` — `User`, `Role`, `Session` types (as §2.1).

### 3.2 Implement `AuthService` (90 min)

- [ ] `packages/auth/src/auth-service.ts`:
  - `findOrCreateUser(userInfo: OidcUserInfo): Promise<User>` — upsert keyed on `oidc_sub`; insert with `roles = ['OPERATOR']` on first sight.
  - `issueAccessToken(user: User, sid: string): Promise<string>` — JWT with `sub`, `email`, `roles`, `sid`, 15-min expiry.
  - `validateAccessToken(token: string): Promise<AuthContext>` — verify signature → load session → assert `revoked_at IS NULL` → return `{ user, sid, roles }`.
- [ ] `packages/auth/src/errors.ts` — `UnauthenticatedError`, `InvalidTokenError`, `SessionRevokedError`.

### 3.3 Implement `SessionService` (60 min)

- [ ] `packages/auth/src/session-service.ts`:
  - `createSession(userId: string): Promise<Session>` — 7-day rolling expiry.
  - `revokeSession(sid: string): Promise<void>` — guarded `UPDATE ... WHERE revoked_at IS NULL`.
  - `touchSession(sid: string): Promise<void>` — extend `expires_at` on activity (rolling window).

### 3.4 OIDC routes in `apps/api` (90 min)

- [ ] `apps/api/src/routes/auth.ts`: `/login`, `/callback`, `/session`, `/logout` per §2.3.
- [ ] Set an **httpOnly, Secure, SameSite=Lax** cookie holding `sid`; the JWT is also returned for API clients.
- [ ] Wire the `sid` into a request-scoped auth context (Fastify `onRequest` hook reads cookie/JWT header).

### 3.5 DI wiring + test (90 min)

- [ ] `apps/api/src/bootstrap.ts` — register `TOKENS.AuthService`, `TOKENS.SessionService`, `TOKENS.OidcProvider` (env-driven: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`).
- [ ] `packages/auth/src/__tests__/auth-service.test.ts` (with a fake `OidcProvider` returning canned `userInfo`):
  - find-or-create is idempotent on `oidc_sub`.
  - validate rejects an expired token.
  - validate rejects a token whose session `revoked_at` is set (revocation kills a still-valid signature).
  - upsert doesn't overwrite an existing user's `roles` on re-login.
- [ ] Update `docs/architecture/wiring-map.md`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/domain/src/identity.ts` | `User`, `Role`, `Session` types |
| `packages/db/migrations/0101_auth.sql` | `users` + `sessions` schema |
| `packages/auth/src/oidc/provider.ts` | `OidcProvider` interface + `openid-client` adapter |
| `packages/auth/src/auth-service.ts` | `findOrCreateUser`, `issueAccessToken`, `validateAccessToken` |
| `packages/auth/src/session-service.ts` | `createSession`, `revokeSession`, `touchSession` |
| `apps/api/src/routes/auth.ts` | Login / callback / session / logout routes |
| `packages/auth/src/__tests__/auth-service.test.ts` | Identity + token + revocation tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/auth test` — all tests pass, including the revocation-kills-valid-signature case.
- [ ] `pnpm --filter @harness/db migrate` applies `0101_auth.sql` cleanly; `psql \d users` shows the `oidc_sub` UNIQUE constraint.
- [ ] `grep -r "from '@harness" packages/auth/src` shows only `@harness/domain`, `@harness/db`, `@harness/di`.
- [ ] A login against a real (or mock) IdP issues a JWT containing `sub`, `roles`, `sid` and an httpOnly `sid` cookie.
- [ ] Calling `/api/auth/session` without a cookie/token returns 401; with a valid token returns the user.
- [ ] Revoking the session (logout) makes the previously-valid JWT fail `validateAccessToken`.
- [ ] `docs/architecture/wiring-map.md` lists the three new registrations.

---

## 6. Notes & Pitfalls

- **Do not delete the `X-Reviewer-Id` header support yet.** Day 02 replaces enforcement end-to-end; until then the old header path must keep working so the pipeline doesn't regress mid-week. Flag it for removal in Day 02's acceptance criteria.
- **`sub` is not a claim you invent.** For OIDC, `sub` comes from `userinfo`/id_token. For a local mock provider used in tests, generate a stable opaque value and treat it the same — never derive `sub` from email.
- **Validate signature before touching the DB.** `validateAccessToken` must verify the JWT first; a forged token that triggers a DB round-trip before signature check is a cheap DoS vector and a logic bug.
- **Don't put the JWT in `localStorage` in the web app.** The session cookie is the durable identity for the browser; the JWT is for API clients. Mixing the two gives you token-theft surface for zero benefit.
- **Upsert must not clobber roles.** A re-login should update `email`/`display_name` but never rewrite `roles` (otherwise every login resets an admin to `OPERATOR`). Add an explicit regression test for it.
- **Next (Day 02):** turn these users into *enforcement* — reviewer roles on the review/decision endpoints and real identity on the audit log.

---

*Next: [Day 2 — AuthZ: Reviewer Roles, Endpoint Enforcement & Audit Identity](day-02.md)*
