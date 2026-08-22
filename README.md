# HAI Harness — Human-Attention Infrastructure

A control plane for **human attention in AI-native development**. AI produces the
work; the harness decides what a human must actually look at — verifying,
scoring, and routing each change so a reviewer sees only what matters, never the
flood. Every step is recorded in an append-only event log, so the whole trail can
be replayed and audited.

> **Hiểu nhanh:** AI viết code, hệ thống tự chạy kiểm tra rồi quyết định cái gì
> *thực sự* cần con người xem — và ghi lại mọi bước để truy vết.

**Status** · `Phase 2 complete` · `v0.2.0-harness` tagged · `build ✔ typecheck ✔ lint ✔ 695 tests ✔ e2e ✔`

---

## What it does

Tasks move through a canonical state machine while dedicated engines do the work:

```text
  Orchestrator        Context Engine       Agent Runtime      Verification
  task lifecycle  →  gather + rank      →  plan + execute   →  compile + test
  (PENDING…DONE)     context (keyword)     agent steps         (real tooling)

                                        ↓
                     Attention Engine — score + budget human attention
                                        ↓
                        Review — a human APPROVES / REJECTS every change
                                        ↓
                          Merge — artifact merged, trail retained
```

Each engine is a `@harness/*` package wired by one DI container
(`apps/api/src/bootstrap.ts`) — see the [wiring map](docs/architecture/wiring-map.md).
No engine imports another.

## Principles

- **Evidence before confidence** — a claim is not evidence. The harness verifies
  (compile + tests) before anything is routed to a human.
- **Human attention is the scarce resource** — the Attention Engine scores and
  budgets approval so a reviewer sees what matters, never the flood.
- **Full provenance** — every state change, LLM call, and decision lands in the
  append-only `event_log`, joined by one `correlation_id`.
- **Shadow-then-default** — a new signal (semantic retrieval, fitted weights)
  earns the default by winning a measured comparison, never by being newer.

## Status

**Phase 2 is complete** (Days 01–30, tagged `v0.2.0-harness`). The exit review
([`docs/retros/phase2-metrics.md`](docs/retros/phase2-metrics.md)) marks **8 of 9**
§7 exit criteria met, the ninth partial. The loop is now **measured**: routing
precision **0.333** / recall **0.5** / escalation-leakage **1.0** (N=4), the A/B
harness reports a real head-to-head with no production effect, `rank_method`
stays `keyword` by construction, and auth + review + sandbox + object-store +
Spec 8/10 are all green. The one honest gap: the fitted attention weights
(log-loss **0.316**) did *not* beat the Phase-1 placeholder (**0.262**), so
calibration is carried into Phase 3 as backlog rather than claimed done.

The decision is **go-with-caveats** — the full record of what held and what
drifted is the [Week-6 retrospective](docs/retros/week-06.md).

### Phase 2 milestones

| Week | Theme | Honest result | Checkpoint |
|---|---|---|---|
| W1 · D01–05 | Identity & observability | OIDC `sub`-keyed SSO, revocable JWT sessions, role gate (`ADMIN ⊇ REVIEWER ⊇ OPERATOR`); OTel `trace_id ↔ correlation_id` + Prometheus `/metrics` | [repo](docs/retros/week-01.md) · [demo](scripts/demo/week1.md) |
| W2 · D06–10 | Evaluation & governance | Offline routing metrics, report scheduler, trajectory replay, read-only A/B shadow harness | [repo](docs/retros/week-02.md) |
| W3 · D11–15 | Calibration & auto-approve | `eval:fit` from real data; auto-approve behind flag + kill-switch + sampling audit. **Fit lost to placeholder (0.316 vs 0.262)** → placeholder kept | [repo](docs/retros/week-03.md) · [demo](scripts/demo/week3-calibration.md) |
| W4 · D16–20 | Semantic infra (shadow) | pgvector + `Embedder`, semantic retriever behind `resolveWithShadow`, exact tiktoken tokenizer, context cache. `rank_method` stays `keyword` | [repo](docs/retros/week-04.md) · [demo](scripts/demo/week4-shadow.md) |
| W5 · D21–25 | Sandbox, object store, Spec 8 | `ContentStore` (S3/MinIO), container `SandboxedCheck`, Spec 8 promoted | — |
| W6 · D26–30 | Harden + exit review | Failure injection, E2E under Phase-2 stack, A/B dry-run (`tau = [-1, -1]`, guardrail HELD → *promote to a real A/B*), exit review + tag | [repo](docs/retros/week-06.md) · [A/B results](docs/retros/week6-ab-results.md) |

<details>
<summary>Phase 1 (complete) — the vertical slice</summary>

Days 01–30 of Phase 1 built the full vertical slice: orchestrator, agent runtime,
context, artifact tracking, verification, attention routing, review, and
observability. It proved the loop end-to-end but was **unmeasured and
uncalibrated** — a single `X-Reviewer-Id` header, placeholder weights, keyword-only
ranking. The honest numbers-first record is the
[Phase 1 retrospective](docs/retros/phase-1.md); deliberate Phase-1 scope cuts are
documented in [limitations.md](docs/runbook/limitations.md).

</details>

**Next up:** [Phase 3 — Learn & Automate Under Guardrails](docs/plan/phase-3/README.md),
starting from the [Phase-3 backlog](docs/plan/phase-3/backlog.md).

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

## Documentation

| What | Where |
| --- | --- |
| **Specifications** — what the system *is* (as-built specs v0.1–v0.3) | [`docs/core/`](docs/core/) |
| **Build plan** — day-by-day plans (Phases 1–3) and backlog | [`docs/plan/`](docs/plan/README.md) |
| **Operations runbook** — incidents, exact commands, escalation rules | [`docs/runbook/`](docs/runbook/README.md) |
| **Developer guide** — clone-to-green in ~15 minutes | [`docs/dev-guide.md`](docs/dev-guide.md) |
| **Wiring map** — the DI object graph | [`docs/architecture/wiring-map.md`](docs/architecture/wiring-map.md) |
| **Retrospectives** — honest weekly post-mortems | [`docs/retros/`](docs/retros/) |

## Repository layout

| Path | What's in it |
| --- | --- |
| `packages/` | 17 engines and shared libraries (`@harness/*`) |
| `apps/api` | Fastify API + the single DI bootstrap (`bootstrap.ts`) + reconcile |
| `apps/web` | React + Vite review UI |
| `docs/core/` | Specification documents (v0.1–v0.3) this implements |
| `docs/plan/` | Day-by-day build plans (Phase 1 / 2 / 3) |
| `docs/architecture/` | Wiring map and living architecture notes |
| `docs/runbook/` | Audit query cookbook + operational runbook + limitations |
| `docs/retros/` | Honest weekly retrospectives |