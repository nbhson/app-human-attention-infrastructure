# Users and Permissions

> **Status:** v1.0 — Day 40 (review-reorient)

This document describes the user model, role hierarchy, permission boundaries,
and operational procedures for managing access in the harness.

---

## Role Hierarchy

The system uses three additive roles (each superset includes the one below):

| Role      | Key | Description                                    | Can do                                                                        |
| --------- | --- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `OPERATOR` | `Operate` | Default role for every authenticated user      | Create/read reviews, submit decisions (see note), read triage rules           |
| `REVIEWER` | `Reviewer` | Trusted humans who judge PRs                   | All OPERATOR actions + write triage rules, approve/reject PRs via write-back  |
| `ADMIN`   | `Admin` | Platform operators                             | All REVIEWER actions + manage providers, settings, kill-switches              |

**Inheritance:** `ADMIN` ⊇ `REVIEWER` ⊇ `OPERATOR`. A user with `["OPERATOR", "REVIEWER"]` has every permission of both roles combined.

---

## Route Permission Matrix

| Endpoint                                    | Method | Minimum Role   | Notes                                                    |
| ------------------------------------------- | ------ | -------------- | -------------------------------------------------------- |
| `/api/reviews`                              | POST   | OPERATOR       | Creates async review                                     |
| `/api/reviews/auto`                         | POST   | OPERATOR       | Synchronous full-code-review mode                        |
| `/api/reviews`                              | GET    | OPERATOR       | Lists reports                                            |
| `/api/reviews/summary`                      | GET    | OPERATOR       | Aggregate counts                                         |
| `/api/reviews/:id`                          | GET    | OPERATOR       | Full report + findings                                   |
| `/api/reviews/:id/decision`                 | POST   | **REVIEWER**   | Approve/reject + optional write-back                     |
| `/api/triage-rules`                         | GET    | OPERATOR       | Read current rule state                                  |
| `/api/triage-rules`                         | PUT    | **REVIEWER**   | Toggle triage rules (autoReviewEnabled, security, etc.) + upload review instructions (text.md)  |
| `/api/settings/providers`                   | GET    | **ADMIN**      | List MCP providers with redacted hints                   |
| `/api/settings/providers`                   | PUT    | **ADMIN**      | Update provider config                                   |
| `/api/admin/*`                              | ANY    | **ADMIN**      | Kill-switch, maintenance endpoints                       |

---

## User Model

Users live in the `users` table, keyed by OIDC `sub` (stable), with display metadata
that can change:

```sql
-- Columns
id            text       -- UUIDv7, internal PK
oidc_sub      text       -- uniqueness anchor, never changes
email         text       -- display, updatable
display_name  text       -- display, updatable
roles         jsonb      -- array of Role keys, e.g. ["OPERATOR","REVIEWER"]
created_at    timestamptz
updated_at    timestamptz
```

**Seeded users** (created by `seed-e2e-fixture`):

| Email                    | Roles                         | Purpose                                    |
| ------------------------ | ----------------------------- | ------------------------------------------ |
| `local@example.com`      | `["OPERATOR"]`                | Default test user — upgrade to REVIEWER/ADMIN as needed |
| `reviewer@example.com`   | `["OPERATOR", "REVIEWER"]`    | Demo reviewer with decision rights         |

> **Note:** After recent fixes, `POST /api/reviews/:id/decision` requires `REVIEWER` or `ADMIN`.
> If you get `403 insufficient role for this action`, add the `REVIEWER` role to your user.

---

## Adding / Updating Roles

Roles are stored as a JSONB array. Use `jsonb_set` to add without replacing existing roles:

```sql
-- Add REVIEWER to local@example.com
UPDATE users
SET roles = jsonb_set(roles, '{1}', '"REVIEWER"')
WHERE email = 'local@example.com'
RETURNING email, roles;

-- Add ADMIN (requires REVIEWER first)
UPDATE users
SET roles = jsonb_set(roles, '{2}', '"ADMIN"')
WHERE email = 'local@example.com'
RETURNING email, roles;

-- Set all roles at once
UPDATE users
SET roles = '["OPERATOR","REVIEWER","ADMIN"]'::jsonb
WHERE email = 'local@example.com'
RETURNING email, roles;
```

**Verify the change:**

```bash
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT email, roles FROM users ORDER BY email;"
```

---

## Permission Enforcement

Role checks happen via `requireRole()` Fastify pre-handler:

```typescript
// In route registration
{ preHandler: requireRole(container, Role.Operate, Role.Reviewer, Role.Admin) }
```

The guard reads the authenticated principal's `roles` array (from the JWT + session)
and returns **401** if unauthenticated, **403** if no matching role.

**Audit trail:** every decision and write-back attempt is logged to `event_log`
with the actor's `roles` at the time, so permission violations are traceable.

---

## Common Operations

### 1. Check your current roles

```bash
# Via API (authenticated)
curl -s localhost:3000/api/auth/me \
  --cookie 'sid=<your-session-id>' | jq '.roles'
```

### 2. List all users

```bash
docker compose exec -T postgres psql -U harness -d harness \
  -c "SELECT email, roles, created_at FROM users ORDER BY created_at;"
```

### 3. Reset a user to OPERATOR only

```sql
UPDATE users
SET roles = '["OPERATOR"]'::jsonb
WHERE email = 'user@example.com'
RETURNING email, roles;
```

### 4. Create a new user (for testing)

```sql
INSERT INTO users (id, oidc_sub, email, display_name, roles)
VALUES (
  gen_random_uuid(),
  'test|user-123',
  'test@example.com',
  'Test User',
  '["OPERATOR","REVIEWER"]'::jsonb
);
```

---

## Security Notes

- **Roles are additive, not hierarchical by DB constraint** — a user can hold any combination.
  The code enforces `ADMIN ⊇ REVIEWER ⊇ OPERATOR` but the DB trusts the operator.
- **OIDC `sub` is immutable** — changing it requires deleting and recreating the user.
- **Session revocation** (`sessions.revoked_at IS NOT NULL`) is independent of roles
  and works for all roles equally.
- **Write-back is dual-gated**: the user must have `REVIEWER`/`ADMIN` AND the
  per-provider toggle must be ON AND the request-level flag must be set.

---

## Troubleshooting

| Symptom                                        | Likely Cause                              | Fix                                                           |
| ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `403 insufficient role for this action`        | User lacks required role                  | Add role via `UPDATE users SET roles = ...`                   |
| `401 Unauthorized`                             | Missing/expired session                   | Re-authenticate via OIDC                                      |
| Decision succeeds but write-back doesn't fire  | `writeback_enabled` flag OFF in request   | Check request body includes `writeback: true`                 |
| Can submit decision but nothing posts to PR    | Provider disabled in `provider_configs`   | Run OP-2 to verify write-back is enabled and provider is ON   |
