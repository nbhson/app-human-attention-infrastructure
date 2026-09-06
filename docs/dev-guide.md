# Developer Guide

HAI Harness turns a PR / MR URL into a stored AI review — a report with findings
and fix suggestions, ready for a human decision.

---

## Quick Start

```sh
git clone <repo-url> harness-human-attention-infrastructure
cd harness-human-attention-infrastructure

pnpm install
docker compose up -d
cp .env.example .env
pnpm --filter @harness/db migrate
pnpm test          # green = you're set
pnpm dev           # start the API + web UI
```

Open **http://localhost:3000/api/auth/login** to log in (mock OIDC, no external
IdP needed). The UI runs at **http://localhost:5173**.

---

## Environment Variables

`.env` is loaded automatically. All values below come from `.env.example` — copy
it and fill in what you need.

### Required (minimum viable)

```sh
DATABASE_URL=postgres://harness:harness@localhost:5432/harness
```
Postgres must be running (`docker compose up -d`). That's all you need to boot
and run tests. Everything else falls back to a local mock.

### AI Provider (pick one)

```sh
# Option A: Ollama (local, free)
AI_BASE_URL=http://localhost:11434/v1
AI_API_KEY=
AI_PROVIDER=custom
AI_MODEL=qwen3.5:2b-mlx

# Option B: OpenAI-compatible cloud
# AI_BASE_URL=https://api.openai.com/v1
# AI_API_KEY=sk-...
# AI_PROVIDER=openai
# AI_MODEL=gpt-4.1
```
Leave `ANTHROPIC_API_KEY` unset to use `AI_BASE_URL`. Set it to switch to
Anthropic (`claude-sonnet-4-6` by default).

### Review Pipeline (optional tuning)

```sh
REVIEW_MAX_BATCH_SIZE=10
REVIEW_MAX_BATCH_TOKENS=10000
REVIEW_TWO_PASS=true
# REVIEW_MAX_CONCURRENCY=4
```
Code defaults (when env is unset): `REVIEW_MAX_BATCH_SIZE=5`, `REVIEW_MAX_BATCH_TOKENS=30000`, `REVIEW_MAX_CONCURRENCY=4` (`apps/api/src/bootstrap.ts:654`). `.env.example` overrides to `10 / 10000` for a gentler provider default — either is valid; the code default is the source of truth. Two-pass mode is ON by default — a lightweight summary pass runs first, then only high/medium risk files are deep-reviewed. Lower these values if the AI provider is rate-limited.

### Git Providers (optional — for real PR reviews)

```sh
GITHUB_TOKEN=ghp_...
GITHUB_BASE_URL=https://api.github.com
JIRA_TOKEN=your-jira-token-here
JIRA_BASE_URL=https://your-site.atlassian.net
GITLAB_TOKEN=your-gitlab-token-here
BITBUCKET_TOKEN=your-bitbucket-token-here
```
Only set the ones you need. Leave others unset — the app falls back to REST or null providers gracefully.

### Identity (local dev)

```sh
OIDC_MOCK=true
JWT_SECRET=dev-only-insecure-secret
COOKIE_SECURE=false
APP_URL=http://localhost:3000
```
`OIDC_MOCK=true` is the default. For a real IdP, set `OIDC_MOCK=false` and fill
in `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.

`JWT_SECRET` must be ≥32 bytes. The app **throws** at boot when `NODE_ENV=production` and the secret is the dev default or unset (`apps/api/src/bootstrap.ts:263`); in dev it warns. Values must match `.env.example:89`.
`COOKIE_SECURE=false` for local HTTP (`http://localhost:3000`); set `true` only behind TLS — `true` over plain HTTP prevents the `sid` cookie from being sent and causes the 401 loop in Troubleshooting below.

---

## Running

```sh
pnpm dev           # API (:3000) + web UI (:5173) with hot reload
pnpm test          # full test suite (~2 min)
pnpm lint          # eslint with architecture boundary enforcement
pnpm typecheck     # tsc --noEmit across all packages
pnpm test:coverage # same suite with v8 coverage + 50/45/50/50 gate (needs docker compose up -d)
```

**Login once per session:** open http://localhost:3000/api/auth/login. After the
mock OIDC flow completes, http://localhost:5173 works without 401s — the Vite
proxy forwards `/api` requests to the backend transparently.

---

## Common Tasks

**Add a database migration:**
```sh
pnpm --filter @harness/db generate   # creates SQL from schema changes
pnpm --filter @harness/db migrate    # applies it
```
Never edit an applied migration — always append a new one.

**Full reset (dev only):**
```sh
docker compose down -v && docker compose up -d && pnpm --filter @harness/db migrate
```
This destroys the `pgdata` volume — only use on throwaway environments.

**Run a single package's tests:**
```sh
pnpm test -- packages/orchestrator
```

---

## What Runs Where

| Port | Service | Notes |
| --- | --- | --- |
| 3000 | API (Fastify) | `/api/auth/*`, `/api/reviews`, `GET /metrics` |
| 5173 | Web UI (Vite) | Proxies `/api` → :3000, serves React app |
| 5432 | Postgres (pgvector) | `docker compose up -d` starts this |

---

## Troubleshooting

**"Connection refused" on port 5432** — Postgres isn't running:
```sh
docker compose up -d
```

**401 on every API call** — session cookie missing. Log in at http://localhost:3000/api/auth/login first.

**Tests fail with schema errors** — migrations not applied:
```sh
pnpm --filter @harness/db migrate
```

**`harness-verify:node20` image not found** — sandbox is opt-in. Run:
```sh
docker build -t harness-verify:node20 packages/sandbox
```
If you don't set `VERIFY_SANDBOX_ENABLED=1`, the app falls back to the
in-process path (no sandbox, no Docker needed).

---

### Feature gates (unset ⇒ default)

| Env | Default | Effect | Docs |
|---|---|---|---|
| `WRITEBACK_ENABLED` | `ON` (unset ⇒ armed) | Global ceiling for write-back | `docs/runbook/operations.md` OP-2, `apps/api/src/writeback-gate.ts` |
| `WRITEBACK_GITHUB / GITLAB / BITBUCKET / JIRA` | `ON` | Per-provider kill | `packages/writeback` |
| `VERIFY_REVIEW_ENABLED` | `ON` | Clone → build → test verifier (wedge #1); `0`/`false` → `SKIPPED` | `apps/api/src/services/review-verification.ts` |
| `VERIFY_SANDBOX_ENABLED` | `OFF` | `SandboxedCheck` vs in-process `CompileCheck` | `packages/sandbox/README.md` |
| `VERIFY_SANDBOX_IMAGE` | `harness-verify:node20` | Docker image for sandbox | `docker build -t harness-verify:node20 packages/sandbox` |
| `VERIFY_CLONE_TIMEOUT_S` | `600` | Clone+verify budget (s) | `apps/api/src/bootstrap.ts:683` |
| `FITTED_WEIGHTS_ENABLED` | `OFF` | `DbWeightsProvider` vs `StaticWeightsAdapter` (CF-2) | `packages/attention-engine/README.md` |
| `EMBEDDINGS_BASE_URL` | unset | `StubEmbedder` → `OpenAICompatibleEmbedder` | `packages/embeddings/README.md` |
| `OBJECT_STORE_ENDPOINT` | unset | Inline `snapshots` → S3/MinIO offload | `packages/object-store/README.md` |
| `EVENT_TRANSPORT` | `inproc` | `inproc` / `redis` / `sqs` | `packages/event-bus/src/transport-resolver.ts` |
| `AI_TIMEOUT_MS` / `AI_MAX_TOKENS` | `600000` / `32000` | Review LLM budget | `apps/api/src/bootstrap.ts:198` |

## Architecture

- Monorepo: pnpm workspaces + Turborepo. 25 `@harness/*` packages, 2 apps.
- Dependency direction: inward toward `domain`. Lint enforces it via
  `eslint-plugin-boundaries`.
- Tests use real Postgres with isolated `harness_test_*` schemas per suite.
- No SQLite, no mocks across package boundaries.

See `docs/runbook/` for operational runbooks.
