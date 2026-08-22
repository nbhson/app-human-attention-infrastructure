# HAI Harness — Human-Attention Infrastructure

A control plane for **human attention in AI-native development**. AI produces the
work; the harness decides what a human must actually look at. An Orchestrator
moves tasks through a canonical state machine (`PENDING → … → COMPLETED`) while
dedicated engines gather context, run an agent, track artifacts, verify with real
tooling, and route the result to a human for review — every step recorded in an
append-only event log so the whole trail can be replayed and audited.

> **Hiểu nhanh:** AI viết code, hệ thống chạy kiểm tra tự động rồi quyết định
> cái gì *thực sự* cần con người xem, và ghi lại mọi bước để truy vết.

## Principles

- **Evidence before confidence** — a claim is not evidence; the harness verifies
  (compile + tests) before anything is routed to a human.
- **Human attention is the scarce resource** — the Attention Engine scores and
  budgets approval so a reviewer only sees what matters, never the flood.
- **Full provenance** — every state change, LLM call, and decision lands in the
  append-only `event_log`, joined by one `correlation_id`.

## Status

**Phase 1 complete** (Days 01–30). What built: the full vertical slice from task
creation to verified, human-merged change — orchestrator, agent runtime, context,
artifact tracking, verification, attention routing, review, and observability.

- **What works:** follow the [Developer Guide](docs/dev-guide.md) to go from
  `git clone` to a green `pnpm e2e` in ~15 minutes.
- **What's deferred:** runtime confines, targeted verification, semantic ranking,
  calibration — see the [Phase 2 backlog](docs/plan/phase-2-backlog.md).
- **How it went:** the honest, numbers-first [Phase 1 retrospective](docs/retros/phase-1.md).
- **Boundaries:** see [limitations.md](docs/runbook/limitations.md) before you
  "fix" something that's a deliberate Phase-1 scope cut.

## Quickstart

```sh
git clone <repo-url> harness-human-attention-infrastructure
cd harness-human-attention-infrastructure
pnpm install                       # links the @harness/* workspace packages
docker compose up -d               # postgres:16 on :5432
cp .env.example .env               # DATABASE_URL + placeholder ANTHROPIC_API_KEY
pnpm --filter @harness/db migrate  # apply migrations
pnpm test                          # unit + integration (~2 min)
pnpm e2e                           # full vertical slice (<3 min)
```

Requirements: Node.js ≥ 20, pnpm ≥ 9 (pinned `9.15.4`), Docker. Full walkthrough
in the [Developer Guide](docs/dev-guide.md).

## Map

| What | Where |
| --- | --- |
| **Specifications** — what the system *is* (v0.2, reconciled with the code) | [`docs/core/`](docs/core/) |
| **Build plan** — the day-by-day plan (Phases 1–3) and backlog | [`docs/plan/`](docs/plan/README.md) |
| **Operations runbook** — incidents, exact commands, escalation rules | [`docs/runbook/`](docs/runbook/README.md) |
| **Developer guide** — clone-to-green in 15 minutes | [`docs/dev-guide.md`](docs/dev-guide.md) |
| **Wiring map** — the DI object graph | [`docs/architecture/wiring-map.md`](docs/architecture/wiring-map.md) |
| **Retrospectives** — honest weekly post-mortems | [`docs/retros/`](docs/retros/) |

## Repository layout

| Path | What's in it |
| --- | --- |
| `packages/` | The engines and shared libraries (`@harness/*`) |
| `apps/api` | Fastify API + the single DI bootstrap (`bootstrap.ts`) + reconcile |
| `apps/web` | React + Vite review UI |
| `docs/core/` | Specification documents (v0.2) this implements |
| `docs/plan/` | Day-by-day build plans (Phase 1 / 2 / 3) |
| `docs/architecture/` | Wiring map and living architecture notes |
| `docs/runbook/` | Audit query cookbook + operational runbook + limitations |
| `docs/retros/` | Honest weekly retrospectives |