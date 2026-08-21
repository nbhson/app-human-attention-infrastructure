# HAI Harness — Human-Attention Infrastructure

A TypeScript monorepo that turns AI-generated code into **verified, human-reviewed,
evidence-backed changes**. An Orchestrator moves tasks through a canonical state
machine while dedicated engines gather context, run agents, track artifacts, and
verify results — every step recorded in an append-only event log.

> **Hiểu nhanh:** Một hệ thống giám sát chất lượng code AI — AI viết, hệ thống
> chạy kiểm tra tự động + mời con người duyệt, và ghi lại mọi bước để truy vết.

## Week 1 status (Foundation) — ✅ green

The vertical slice from *task creation → state machine → event log* runs
end-to-end against a real PostgreSQL instance (`apps/api/src/__tests__/week1-smoke.test.ts`).

| Component | Package | Day | Status |
|-----------|---------|-----|--------|
| Monorepo scaffold, tooling, CI | root | 01 | ✅ |
| Core types + branded IDs | `@harness/domain` | 02 | ✅ |
| Event envelope + `IEventBus` | `@harness/event-bus` | 03 | ✅ |
| PostgreSQL schema + `EventLogWriter` | `@harness/db` | 04 | ✅ |
| DI container + boundary enforcement | `@harness/di` | 05 | ✅ |
| Task state machine + `TaskService` | `@harness/orchestrator` | 06 | ✅ |
| E2E smoke test + retrospective | `apps/api` / `docs/retros` | 07 | ✅ |

The full gate — `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` — is
green.

## Requirements

- Node.js ≥ 20 (see `.nvmrc`)
- pnpm ≥ 9 (`packageManager` pins 9.15.4)
- Docker (for the local PostgreSQL)

## Getting started

```sh
# 1. Install dependencies (links workspace packages).
pnpm install

# 2. Start PostgreSQL (creates the `harness` database).
docker compose up -d

# 3. Configure the connection string.
cp .env.example .env   # defaults to postgres://harness:harness@localhost:5432/harness

# 4. Apply migrations + (optional) seed data.
pnpm --filter @harness/db migrate
pnpm --filter @harness/db seed

# 5. Verify everything.
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

`pnpm test` runs against isolated per-suite schemas it creates and drops itself, so
it never touches your dev database.

## Repository layout

| Path | What's in it |
|------|--------------|
| `packages/` | The engine and shared-library packages (`@harness/*`) |
| `apps/api` | Fastify API + the single DI bootstrap (`bootstrap.ts`) |
| `apps/web` | Web frontend (scaffold) |
| `docs/core/` | The specification documents this implements |
| `docs/plan/` | Day-by-day build plans (Phase 1 / 2 / 3) |
| `docs/architecture/` | Wiring map and other living architecture notes |
| `docs/retros/` | Honest weekly retrospectives |

## Plans & architecture

- [Implementation plans](docs/plan/README.md) — three phases, one file per day.
- [Wiring map](docs/architecture/wiring-map.md) — the object graph built by `bootstrap.ts`.
- [Week 1 retro](docs/retros/week-01.md) — what's solid, what's fragile, what to watch.