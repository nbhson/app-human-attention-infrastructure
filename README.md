# HAI Harness — Human-Attention Infrastructure

**A control plane for human attention in AI-native development.** AI produces the
work; the harness verifies, scores, and routes each change so a reviewer sees only
what actually matters — never the flood. Every step lands in an append-only event
log, so the entire trail is replayable, queryable, and auditable.

| | |
| --- | --- |
| **Status** | Phase 2 complete · tagged `v0.2.0-harness` |
| **Quality gates** | build ✅ · typecheck ✅ · lint ✅ · 695 tests ✅ · e2e ✅ |
| **Stack** | TypeScript · Fastify · React (Vite) · PostgreSQL (Drizzle) · OpenTelemetry · Docker |
| **Boundary model** | 17 `@harness/*` packages; engines never import another engine |

---

## What it does

A task moves through a canonical, 13-state machine while dedicated engines do the
work. One DI container (`apps/api/src/bootstrap.ts`) wires the packages; no engine
knows another's internals.

```text
 PENDING ─▶ QUEUED ─▶ EXECUTING ─▶ VERIFYING ─▶ AWAITING_REVIEW ─▶ APPROVED ─▶ COMPLETED
              │          │   │          │   │           │
              │          │   │          │   │           └─▶ REJECTED ─▶ REWORK ──▶ QUEUED
              │          │   │          │   └─▶ REWORK ──▶ QUEUED
              │          │   │          └─▶ FAILED
              │          │   └─▶ AWAITING_HUMAN_INTERVENTION
              │          └─▶ FAILED
              └──▶ CANCELLED   (terminal, alongside COMPLETED)
```

| Engine | Role |
| --- | --- |
| **Orchestrator** | Owns the Task state machine, dispatch, workflow, retry |
| **Context Engine** | Gathers, ranks, and budgets the context an agent sees (exact `tiktoken` tokens) |
| **Agent Runtime** | Plans and executes agent steps; records the full trajectory |
| **Verification Engine** | Independent compile + test + sandboxed checks (real tooling) |
| **Attention Engine** | Scores each change and budgets human attention (+ gated auto-approve) |
| **Review** | A human APPROVES / REJECTS every change, with rationale |
| **Artifact Tracker** | Snapshots, diffs, and provenance for every change |

See [the wiring map](docs/architecture/wiring-map.md) for the full object graph.

## Principles

- **Evidence before confidence** — a claim is not evidence. The harness verifies
  (compile + tests) before anything reaches a human.
- **Human attention is the scarce resource** — the Attention Engine scores and
  budgets approval so reviewers see what matters, never the flood.
- **Full provenance** — every state change, LLM call, and decision lands in the
  append-only `event_log`, joined by one `correlation_id`.
- **Shadow-then-default** — a new signal (semantic retrieval, fitted weights)
  earns the default by winning a measured comparison, never by being newer.

## Packages

| Layer | Packages |
| --- | --- |
| **Engines** | `orchestrator`, `agent-runtime`, `context-engine`, `artifact-tracker`, `attention-engine`, `verification-engine`, `review` |
| **Phase-2 seams** | `auth`, `embeddings`, `evaluation`, `object-store`, `observability`, `sandbox` |
| **Shared foundation** | `domain`, `db`, `di`, `event-bus` |

Each package documents its purpose, data model, invariants, and boundary rules in
its own `README.md`.

## Quickstart

```sh
git clone <repo-url> harness-human-attention-infrastructure
cd harness-human-attention-infrastructure
pnpm install                        # links the @harness/* workspace packages
docker compose up -d                # Postgres :5432 · Prometheus :9090 · Grafana :3001 · MinIO :9000
cp .env.example .env                # DATABASE_URL + placeholder ANTHROPIC_API_KEY
pnpm --filter @harness/db migrate   # apply migrations
pnpm test                           # unit + integration (~2 min)
pnpm e2e                            # full vertical slice (<3 min)
```

**Requirements:** Node.js ≥ 20, pnpm ≥ 9 (pinned `9.15.4`), Docker. Full walkthrough
in the [Developer Guide](docs/dev-guide.md).

## Status & roadmap

**Phase 2 is complete** (Days 01–30). The exit review
([`docs/retros/phase2-metrics.md`](docs/retros/phase2-metrics.md)) marks **8 of 9**
§7 exit criteria met, the ninth partial. The loop is now **measured**: routing
precision **0.333** / recall **0.5** / escalation-leakage **1.0** (N=4); the A/B
harness reports a real head-to-head with no production effect; `rank_method` stays
`keyword` by construction; and auth, review, sandbox, object-store, and Spec 8/10
are all green. The one honest gap: fitted attention weights (log-loss **0.316**)
did *not* beat the Phase-1 placeholder (**0.262**), so calibration carries into
Phase 3 as backlog rather than being claimed done.

The decision is **go-with-caveats** — the full record of what held and what drifted
is the [Week-6 retrospective](docs/retros/week-06.md).

### Phase 2 milestones

| Week | Theme | Honest result | Checkpoint |
|---|---|---|---|
| W1 · D01–05 | Identity & observability | OIDC `sub`-keyed SSO, revocable JWT sessions, role gate (`ADMIN ⊇ REVIEWER ⊇ OPERATOR`); OTel `trace_id ↔ correlation_id` + Prometheus `/metrics` | [repo](docs/retros/week-01.md) · [demo](scripts/demo/week1.md) |
| W2 · D06–10 | Evaluation & governance | Offline routing metrics, report scheduler, trajectory replay, read-only A/B shadow harness | [repo](docs/retros/week-02.md) |
| W3 · D11–15 | Calibration & auto-approve | `eval:fit` from real data; auto-approve behind flag + kill-switch + sampling audit. **Fit lost to placeholder (0.316 vs 0.262)** → placeholder kept | [repo](docs/retros/week-03.md) · [demo](scripts/demo/week3-calibration.md) |
| W4 · D16–20 | Semantic infra (shadow) | pgvector + `Embedder`, semantic retriever behind `resolveWithShadow`, exact tiktoken tokenizer, context cache. `rank_method` stays `keyword` | [repo](docs/retros/week-04.md) · [demo](scripts/demo/week4-shadow.md) |
| W5 · D21–25 | Sandbox, object store, Spec 8 | `ContentStore` (S3/MinIO), container `SandboxedCheck`, Spec 8 promoted | — |
| W6 · D26–30 | Harden + exit review | Failure injection, E2E under the Phase-2 stack, A/B dry-run (`tau = [-1, -1]`, guardrail HELD → *promote to a real A/B*), exit review + tag | [repo](docs/retros/week-06.md) · [A/B results](docs/retros/week6-ab-results.md) |

<details>
<summary>Phase 1 (complete) — the vertical slice</summary>

Days 01–30 of Phase 1 built the full vertical slice: orchestrator, agent runtime,
context, artifact tracking, verification, attention routing, review, and
observability. It proved the loop end-to-end but was **unmeasured and
uncalibrated** — a single `X-Reviewer-Id` header, placeholder weights, keyword-only
ranking. The honest, numbers-first record is the
[Phase 1 retrospective](docs/retros/phase-1.md); deliberate Phase-1 scope cuts are
documented in [limitations.md](docs/runbook/limitations.md).

</details>

**Next up:** [Phase 3 — Learn & Automate Under Guardrails](docs/plan/phase-3/README.md),
starting from the [Phase-3 backlog](docs/plan/phase-3/backlog.md).

## Documentation

| What | Where |
| --- | --- |
| **Specifications & package docs** | Architecture spec at [`docs/core/`](docs/core/) + one `README.md` per `@harness/*` package |
| **Build plan** | [`docs/plan/`](docs/plan/README.md) — day-by-day plans (Phases 1–3) and backlog |
| **Operations runbook** | [`docs/runbook/`](docs/runbook/README.md) — incidents, exact commands, escalation rules |
| **Developer guide** | [`docs/dev-guide.md`](docs/dev-guide.md) — clone-to-green in ~15 minutes |
| **Wiring map** | [`docs/architecture/wiring-map.md`](docs/architecture/wiring-map.md) — the DI object graph |
| **Retrospectives** | [`docs/retros/`](docs/retros/) — honest weekly post-mortems |

## Repository layout

| Path | What's in it |
| --- | --- |
| `packages/` | 17 engines and shared libraries (`@harness/*`) |
| `apps/api` | Fastify API + the single DI bootstrap (`bootstrap.ts`) + reconcile |
| `apps/web` | React + Vite review UI |
| `docs/core/` | The architecture specification (subsystem docs live in each package's `README.md`) |
| `docs/plan/` | Day-by-day build plans (Phases 1 / 2 / 3) |
| `docs/architecture/` | Wiring map and living architecture notes |
| `docs/runbook/` | Audit-query cookbook + operational runbook + limitations |
| `docs/retros/` | Honest weekly retrospectives |