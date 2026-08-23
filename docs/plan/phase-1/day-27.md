# Day 27 — Provider config hygiene: token redaction, sanitized env, no live keys

| | |
|---|---|
| **Week** | W4 — Human loop + E2E |
| **Spec refs** | Spec 1 §5 (replaceable integrations), plan README §7 (no live keys) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 26 (hardened pipeline with logging + errors) |

---

## 1. Objectives

- Guarantee **no live API keys** in the repo: `.env.example` carries placeholders only, and any committed config is inert.
- Add **token redaction** so tokens never appear in logs, errors, event payloads, or audit records.
- Sanitize the environment surfaced to config: load from `env`, validate, and keep secrets out of process args/dumps.
- Prove verification/reviews run against **fixtures/mocks**, never a real paid LLM in tests — the real provider path is compile-tested only.

## 2. Design Decisions

- Secrets are injected via `env` and passed through a redacting serializer; the logger and error mapper redact by pattern (`key=`, bearer headers) and by config field name.

```ts
const safe = (t: string) => (t?.length > 4 ? `${t.slice(0, 4)}…[redacted]` : '[redacted]');
// applied to tokens, keys, and provider config before any log/error emit
```

- `.env.example` ships only `GITHUB_TOKEN=`, `JIRA_TOKEN=`, `LLM_API_KEY=`, `LLM_BASE_URL=https://localhost` style placeholders. A CI `secrets` scan fails the build on any token-looking literal.
- The real `OpenAICompatibleProvider`/`GitHubProvider` code path is compiled and unit-tested against fixtures; it is never invoked with a live key in CI.

## 3. Tasks

### 3.1 Redaction + env sanitization (150 min)
- [ ] `apps/api/src/config/redact.ts` redacting logger/error mapper
- [ ] `apps/api/src/config/env.ts` — typed env loader validating + masking

### 3.2 Secret scan + `.env.example` (120 min)
- [ ] `.env.example` placeholders only; `gitleaks`/regex scan in CI
- [ ] Audit git history for any previously committed key; scrub if found

### 3.3 Tests (90 min)
- [ ] Token never appears in logs/errors/events; scan fails on a planted secret; compile-only real-provider test

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/config/redact.ts` | Redaction helpers |
| `apps/api/src/config/env.ts` | Sanitized env loader |
| `apps/api/.env.example` | Placeholder-only config |
| `.github/workflows/secrets-scan.yml` | Secret-scan CI job |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes redaction + env tests
- [ ] `.env.example` has zero real-looking token values; a planted secret triggers the CI scan
- [ ] A provider error/log line contains `[redacted]`, never the token
- [ ] No test reads a live key or invokes a paid LLM (real path is compile-tested only)

## 6. Notes & Pitfalls

- Redact at the *boundary* (logger + error mapper), don't rely on callers remembering — a single choke point, not discipline.
- Treat this as the Day-30 success criterion "no live API keys": it is a gate, not a nicety.

---

*Next: [Day 28 — Documentation: specs → v0.2, dev guide, runbook](day-28.md)*