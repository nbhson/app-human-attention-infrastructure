# @harness/auth — Identity & Authorization

Real reviewer identity (OIDC SSO) and role enforcement for the review and audit
surfaces, replacing the earlier `X-Reviewer-Id` header placeholder.

**Status:** complete (as-built) ·
**Boundary rule:** shared package — imports only `@harness/domain`, `@harness/db`, `@harness/event-bus`, `@harness/di`; **not** a pipeline step.

---

## Purpose

1. **Establish identity** keyed on the provider-stable OIDC `sub` (never email — emails get reassigned).
2. **Mint sessions** — a signed JWT proves _who_, a live `sessions` row proves _still allowed_.
3. **Revoke** sessions so a leaked token dies the moment its session is revoked.
4. **Enforce roles** with `requireRole`, additive: `ADMIN ⊇ REVIEWER ⊇ OPERATOR` (default `['OPERATOR']`).
5. **Emit denial evidence** — `authz.decision_denied` instead of a silent 403.

---

## Identity & session model

```text
      OIDC flow (openid-provider | mock-provider)
                     │  exchange for
                     ▼
        ┌────────────────────────────┐
        │  session row (users.id FK) │   ← live source of truth
        │  signed JWT                │   ← stateless "who" proof
        └────────────────────────────┘
                     │  requireRole gate
                     ▼
        AuthContext { user, sid, roles }
```

- Internal rows FK to `users.id` (UUIDv7) — re-provisioning a user never rewrites history.
- `event_log.actor_id` and `decisions.actor_id` FK to `users.id`, so the audit
  trail names a human, not a token.
- The role gate runs at the route; the authenticated actor is sourced from `req.auth`.

---

## Modules

| Module                    | What it provides                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `auth-service.ts`         | Login/logout orchestration: OIDC exchange → session + minted JWT.                                 |
| `session-service.ts`      | Session lifecycle — create, validate (`revoked_at IS NULL`), revoke (kills every token under it). |
| `require-role.ts`         | Endpoint guard — asserts `roles`, emits `authz.decision_denied` on refusal.                       |
| `oidc/provider.ts`        | The `OidcProvider` seam.                                                                          |
| `oidc/openid-provider.ts` | Real OpenID-Connect provider adapter.                                                             |
| `oidc/mock-provider.ts`   | Deterministic mock for tests/CI without a live IdP.                                               |
| `errors.ts`               | Auth/authorization error types.                                                                   |

---

## Interaction with other packages

```text
                 @harness/domain, @harness/db, @harness/event-bus  (shared only)
                                │
                      ┌─────────┴─────────┐
                      │     @harness/auth │
                      └───────────────────┘
                                │  requireRole (exported; used by apps/api)
                                ▼
              apps/api review + decision routes (the role gate)
```

Authentication is **not** a pipeline step — it neither publishes nor consumes
harness events. The single outbound event (`authz.decision_denied`) is emitted
from `apps/api` via the exported `requireRole`, a deliberate exception to the
event-driven rule.

---

## Key invariants

- **`sub`, not email.** Identity is stable under email reassignment.
- **Session revocation beats a valid signature.** A token is dead when its
  session is revoked, signature valid or not.
- **Denials are evidence.** Every refused action is recorded, not swallowed.

---

## Directory structure

```
src/
├── index.ts
├── auth-service.ts
├── session-service.ts
├── require-role.ts
├── errors.ts
└── oidc/
    ├── provider.ts
    ├── openid-provider.ts
    └── mock-provider.ts
```

## Public API surface

```typescript
// AuthService, SessionService, RequireRole, OidcProvider,
// OpenIdProvider, MockProvider, + auth error types
```

## Wiring

Registered in `apps/api/src/bootstrap.ts`; `requireRole` wraps the review and
decision routes in `apps/api/src/routes`.
