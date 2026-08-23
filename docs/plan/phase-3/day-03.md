# Day 03 — Provider Registry + `provider_configs` (Redacted) Resolution

| | |
|---|---|
| **Week** | 1 — Provider breadth |
| **Spec refs** | git-provider §2 (seam), §6 (public API); Architecture §7 (boundary rule, token hygiene) |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 01–02 (`GitLabProvider`, `BitbucketProvider` ship; `GitHubProvider` exists) |

---

## 1. Objectives

By end of day you will have:

1. A `provider-registry.ts` that resolves any PR/MR **URL** to the right `GitProvider` instance (`github` | `gitlab` | `bitbucket`).
2. A `provider_configs` table + resolution path: host-scoped config (token, `baseUrl`) resolved per request, with **tokens stored redacted/encrypted and never logged**.
3. A hosted `resolveProvider(url)` used by the ingress route instead of the Phase-2 hard-coded `GitHubProvider`.
4. Fixture-tested registry + config resolution and token-redaction tests.

This is the day the "provider breadth" slice becomes a *configurable seam*, not three hard-coded classes.

---

## 2. Design Decisions

### 2.1 Registry keyed by host, resolved from URL

```typescript
// packages/git-provider/src/provider-registry.ts
export interface GitProviderRegistry {
  resolve(url: string): Promise<GitProvider>;   // throws UnknownProviderHostError
}
```

`parseRepoPath(url)` (Days 01–02) yields a host; the registry maps `host ∈ {github.com, gitlab.com, bitbucket.org, …self-hosted}` → provider. Self-hosted orgs register their `baseUrl` in `provider_configs` and match by host prefix.

### 2.2 `provider_configs` schema (Drizzle, in `@harness/db`)

```typescript
export const providerConfigs = pgTable('provider_configs', {
  id:           text('id').primaryKey(),        // uuidv7
  host:         text('host').notNull(),         // 'github.com' | 'gitlab.com' | self-hosted base
  provider_type:text('provider_type').notNull(),// 'github' | 'gitlab' | 'bitbucket'
  token_enc:    text('token_enc').notNull(),    // AES-GCM ciphertext, base64
  token_hint:   text('token_hint'),             // last-4 only, for the human UI — never the token
  base_url:     text('base_url'),               // nullable → provider default
  enabled:      boolean('enabled').notNull().default(true),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ hostIdx: index('provider_configs_host_idx').on(t.host) }));
```

- **Never plaintext tokens.** `token_enc` is AES-GCM encrypted with a per-environment key from `process.env.HARNESS_CONFIG_KEY`; `token_hint` (last 4) is the only cleartext token material — safe for the settings UI and audit log.
- **Redaction at the boundary.** Every log/event emitter for these rows goes through a `redactProviderConfig()` that strips `token_enc` and keeps only `id`, `host`, `provider_type`, `token_hint`.

### 2.3 Decrypt-at-use, never at load

The registry fetches the config row for the host and decrypts `token_enc` *inside* the provider call scope, then passes the decrypted token straight to the adapter — it is never held on a long-lived object and never leaves the process boundary.

---

## 3. Tasks

### 3.1 Schema + migration (60 min)

- [ ] `packages/db/src/schema/provider-config.ts` — `providerConfigs` (§2.2).
- [ ] Generate + apply migration.

### 3.2 Token crypto helper (60 min)

- [ ] `packages/git-provider/src/crypto.ts` — `encryptToken`/`decryptToken` (AES-256-GCM, key from `HARNESS_CONFIG_KEY`).
- [ ] `redactProviderConfig()` — strips `token_enc`, keeps `token_hint`.
- [ ] Unit tests: round-trip; tampered ciphertext → throw; redaction leaves no token bytes.

### 3.3 `provider-registry.ts` (90 min)

- [ ] Registry mapping host → provider class; self-hosted host-prefix match from `base_url`.
- [ ] `resolve(url)` → load row for host → decrypt → instantiate provider with `{ token, baseUrl }`.
- [ ] `UnknownProviderHostError` on no match / disabled config.

### 3.4 Ingress wiring (45 min)

- [ ] Swap the reviews route's hard-coded `GitHubProvider` for `registry.resolve(prUrl)`.
- [ ] Ensure the decrypted token is passed into the adapter and immediately dropped from scope.

### 3.5 Config endpoint (45 min)

- [ ] `POST /api/provider-configs` + `GET /api/provider-configs` (redacted) — create/list with redaction applied on every response.

### 3.6 Tests (60 min)

- [ ] Registry: each host resolves the right provider; unknown host throws.
- [ ] Config resolution: token round-trips; disabled config rejects.
- [ ] Redaction: `list` response contains `token_hint`, never `token_enc`/plaintext.
- [ ] Boundary grep: registry imports only `@harness/domain` + `@harness/db`.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/db/src/schema/provider-config.ts` | `provider_configs` schema |
| `packages/db/migrations/0xxx_provider_configs.sql` | Migration |
| `packages/git-provider/src/provider-registry.ts` | `GitProviderRegistry.resolve(url)` |
| `packages/git-provider/src/crypto.ts` | `encryptToken`/`decryptToken`/`redactProviderConfig` |
| `apps/api/src/routes/provider-configs.ts` | Create/list config endpoints (redacted) |
| `apps/api/src/routes/reviews.ts` (updated) | Ingress uses registry |

---

## 5. Acceptance Criteria

- [ ] Registry: `resolve("https://gitlab.com/acme/api/-/merge_requests/1")` → `GitLabProvider`; same for GitHub/Bitbucket.
- [ ] Tokens stored as ciphertext; `token_hint` is the last-4 only.
- [ ] Config `GET` response never contains `token_enc` or plaintext token.
- [ ] `decryptToken` throws on a tampered ciphertext.
- [ ] Ingress review path no longer hard-codes `GitHubProvider`.
- [ ] `pnpm lint` clean; no live keys committed; `.env.example` documents `HARNESS_CONFIG_KEY`.

---

## 6. Notes & Pitfalls

- **The config table is per provider host, not per user.** One `provider_configs` row per org/self-hosted base URL is the model; per-user tokens (if ever) are a later extension, not today.
- **Never log the decrypted token.** The decrypt-at-use scope (§2.3) plus `redactProviderConfig()` is the countermeasure; add a test that greps any emitted event for token bytes and fails.
- **`HARNESS_CONFIG_KEY` in CI.** The migration and crypto tests must run with a throwaway key injected by the test harness — not a committed default.
- **Tomorrow (Day 04):** harden `JiraProvider` with comments + transition — the ticket side of breadth.

---

*Next: [Day 04 — Harden `JiraProvider`: Comments + Transition Beside Fetch](day-04.md)*