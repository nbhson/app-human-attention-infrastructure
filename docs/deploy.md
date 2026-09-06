# Deployment Guide

> **Shape:** one API process + one Postgres (`pgvector`) + optional Docker sandbox. No replicas, no message broker by default. See `docs/runbook/limitations.md` for why.

## 1. Requirements

- Node.js ≥ 20, pnpm ≥ 9.15.4, Docker (optional, for `VERIFY_SANDBOX_ENABLED=1`)
- Postgres 16 with `pgvector` (provided by `docker-compose.yml`; any managed Postgres with the extension works)

## 2. Environment

Copy env + MCP config (both gitignored):

```sh
cp .env.example .env
cp mcp.config.example.json mcp.config.json
# then edit .env: DATABASE_URL, provider tokens, OIDC, JWT_SECRET, APP_URL
# and mcp.config.json: tokenEnv names must match .env keys
```

Single reference for every var: `docs/env.md`. Minimum to boot and run tests: `DATABASE_URL` only.

### Production traps

| Trap | What happens | Fix |
|---|---|---|
| `JWT_SECRET` unset or `dev-only-insecure-secret` with `NODE_ENV=production` | `bootstrap.ts:266` throws at boot | Set ≥32 random bytes (`openssl rand -base64 32`) |
| `COOKIE_SECURE=true` on plain `http://localhost` | Browser drops `sid` → 401 loop (`routes/auth.ts:71`) | Keep `false` locally; `true` only behind TLS |
| `APP_CORS_ORIGINS=*` with credentials in prod | `app.ts:88` throws at boot | Pin to your deploy origin (`https://app.example.com`) |
| `OIDC_MOCK=true` in prod | Mock login accepts anyone | Set `OIDC_MOCK=false` + `OIDC_ISSUER_URL/CLIENT_ID/CLIENT_SECRET` |
| No `mcp.config.json` | App boots with empty `McpServerRegistry` — PR fetch 404/422, write-back no-op | Copy `mcp.config.example.json` even for placebo tokens |

## 3. Database

```sh
pnpm --filter @harness/db migrate      # applies 51 migrations idempotently
pnpm --filter @harness/db generate     # after schema edits — never edit an applied .sql
```

`DATABASE_URL` must point at a database where the process can `CREATE EXTENSION vector`. On managed Postgres, install `pgvector` first.

## 4. Build & run

```sh
pnpm install
pnpm build                  # tsc for all 25 packages + apps/api + apps/web
# dev
pnpm dev                    # API :3000 + web :5173 (Vite, hot reload)
# prod
pnpm build && pnpm --filter @harness/api start   # node dist/index.js
# or
node apps/api/dist/index.js
```

Startup sequence (`docs/architecture/runtime-startup.md`): `.env` load → `buildContainer()` (lazy) → `initApiTracing()` (OTel) → `buildApp()` (10 route groups) → `bootContainer()` (14 eager subscribers) → `app.listen(3000)`.

On boot the process publishes `system.started` (and `system.stopped` on `SIGINT/SIGTERM`) into `event_log` (`apps/api/src/index.ts:33`).

## 5. Process management

### Single-process constraint

Do **not** run more than one API replica without reading `docs/runbook/limitations.md` §1–§3. There is no leader election, no backpressure, `InProcessEventBus` default is in-memory only, and `pendingLogins` (`routes/auth.ts:37`) is an in-memory map.

### Systemd (example)

```ini
[Unit]
Description=HAI Harness API
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=harness
WorkingDirectory=/opt/harness-human-attention-infrastructure
EnvironmentFile=/opt/harness-human-attention-infrastructure/.env
ExecStart=/usr/bin/pnpm --filter @harness/api start
Restart=on-failure
RestartSec=5
# graceful shutdown so in-flight review ingest drains
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

For Fly/Render/etc: same `ExecStart`, inject `.env` vars as secrets, provision Postgres with `pgvector`.

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
```

The only container the compose file provides is Postgres; the API is expected to run as a normal process (not inside compose) so `SANDBOX_ROOT` is a host path.

## 6. Sandbox (optional)

```sh
docker build -t harness-verify:node20 packages/sandbox
# then in .env:
# VERIFY_SANDBOX_ENABLED=1
```

`harness-verify:node20` is referenced by `VERIFY_SANDBOX_IMAGE` (`bootstrap.ts:556`). Without it `SandboxedCheck` falls back to in-process with a warning (`harness_sandbox_fallback_total`). Without `VERIFY_SANDBOX_ENABLED`, verification uses the in-process `CompileCheck` only.

## 7. Reverse proxy / TLS

```
Internet → TLS terminator (Caddy/Nginx) → API :3000
                                  → Web  :5173 (or static build served by same proxy)
```

- Set `APP_URL=https://your.domain` so OIDC callback URL is correct.
- Set `COOKIE_SECURE=true` once TLS is terminating.
- Set `APP_CORS_ORIGINS=https://your.domain` (never `*` with credentials in prod).
- Forward `X-Forwarded-For` so `request.ip` rate-limit (`app.ts:58`) is correct.

## 8. Object store / embeddings / durable queue (all optional)

All three are **opt-in** behind env; unset ⇒ zero-config local path (inline snapshots, `StubEmbedder`, `InProcessEventBus`). To enable, provision the backing service and set the vars in `docs/env.md` §8. For `EVENT_TRANSPORT=redis/sqs` you must supply a `StreamTransport` adapter — the repo ships none (see `packages/event-bus/src/transport-resolver.ts` and `docs/runbook/operations.md` OP-5).

## 9. Observability

- Tracing: OTel provider initialized at boot (`observability.ts`); traces join `event_log` via `trace_correlation` (`packages/db/src/schema/trace-correlation.ts`).
- Metrics: `GET /metrics` (Prometheus format, no auth) — scrape with `prometheus.yml`. Grafana example in `docs/observability.md`.
- Audit: `GET /api/audit` + `docs/runbook/audit-queries.md` Q1–Q9.

## 10. Checks after deploy

```sh
curl -s http://localhost:3000/health            # { status: "ok" }
curl -s http://localhost:3000/api/ops/health       # DB probe
curl -s http://localhost:3000/metrics | head -20
# log in:
open http://localhost:3000/api/auth/login
# then paste a PR URL in the web UI (http://localhost:5173) or:
curl -s -X POST http://localhost:3000/api/reviews \
  -H 'content-type: application/json' --cookie 'sid=<from login>' \
  -d '{"prUrl":"https://github.com/org/repo/pull/1"}'
```

If the PR fetch fails with 404/422: check `mcp.config.json` + `GITHUB_TOKEN` + `McpServerRegistry` (`GET /api/settings/providers` as Admin).

## Related docs

- `docs/env.md` — every env var
- `docs/runbook/README.md` — incidents R1–R10 (copy-paste)
- `docs/observability.md` + `prometheus.yml` — monitoring setup
- `docs/architecture/runtime-startup.md` — what loads at boot
