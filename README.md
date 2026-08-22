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

### Phase 2 · Week 1 complete — Identity & Observability

The first Phase-2 week (days 01–05) hardens *who is acting* and *what can we
see* before Week 2 starts measuring. All five days verified: lint, typecheck,
92 test files (384 tests), and the e2e happy-path + 8 failure scenarios green.

- **Identity** — SSO logins keyed on the provider-stable OIDC `sub`
  (not email), revocable JWT sessions, role-gated review routes (`ADMIN ⊇
  REVIEWER ⊇ OPERATOR`) where `audit identity` comes from the authenticated
  principal — the Phase-1 reviewer-id header is gone.
- **Observability** — OTel spans with a `trace_id ↔ correlation_id` join, plus a
  Prometheus `/metrics` scrape (routing, review dwell, usefulness) with
  dashboards-in-code under `infra/`.
- **Checkpoint** — the scripted [Week-1 demo](scripts/demo/week1.md) and the
  numbers-first [Week-1 retrospective](docs/retros/week-01.md).

### Phase 2 · Week 2 complete — Evaluation & Governance

Days 06–10 put the pipeline *under measurement*: offline routing metrics
(precision/recall/escalation-leakage), a scheduled report generator, trajectory
replay, and a read-only A/B shadow harness. The honest checkpoint read
(`docs/retros/week-02.md`) is that the pipeline is now *measured but not yet
calibrated* — every gauge resolves to a real value, and escalation leakage (1.0
on the N=4 window) is the number Week 3 exists to move.

### Phase 2 · Week 3 complete — Calibration & Auto-Approve

Days 11–15 closed the loop the Week-2 retro called for: a frozen calibration
dataset → real weight fitting → adaptive thresholds → a gated auto-approve path
with flag, kill-switch, and sampling audit. The checkpoint was a **hard** one,
and the honest result is red: the fitted weights (log-loss **0.316**) did *not*
beat the Phase-1 placeholder (log-loss **0.262**) on the held-out set, so the
placeholder stays active and auto-approve stays disabled by default.

- **Calibration** — `eval:make-dataset` extracts a hash-sealed snapshot of the
  decision log; `eval:fit` trains five weights and prints a before/after report
  with an `improvement` verdict + governance note (never auto-promotes a regress).
- **Auto-approve** — an ADMIN-gated flag + kill-switch behind a three-part gate
  (calibration green ∧ flag on ∧ under the bar); machine decisions record
  `AUTO_APPROVED` with `actor_id IS NULL`; a 10% silent-human sample audits leakage.
- **Checkpoint** — the scripted [Week-3 demo](scripts/demo/week3-calibration.md)
  and the numbers-first [Week-3 retrospective](docs/retros/week-03.md). Auto-approve
  ships **OFF**; the demo proves the path, then restores the safe default.

### Phase 2 · Week 4 complete — Semantic infra (in shadow)

Days 16–20 installed the semantic substrate *without touching the default path*:
pgvector, an `Embedder` provider seam, the index + re-embed listener, a semantic
retriever/ranker that only runs behind the `resolveWithShadow` opt-in, an exact
tiktoken tokenizer, and a context source cache. The week's honest invariant —
`rank_method` stays `keyword` for the served snapshot while `shadow_rank_comparisons`
records the semantic order — is asserted end-to-end in the checkpoint.

- **Exact tokenizer** — `TiktokenTokenizer` behind the `Tokenizer` seam replaces
  the Phase-1 `chars/4` heuristic (`count`/`truncate` with UTF-8-safe backoff).
- **Context cache** — a Postgres-backed leaf keyed by `source_id + content_hash`;
  the hash is the truth, a `(mtime, size)` stat fast-path serves hits with zero
  file reads, and `artifact.changed` invalidates. Snapshot is never cached.
- **Checkpoint** — the scripted [Week-4 demo](scripts/demo/week4-shadow.md) and the
  numbers-first [Week-4 retrospective](docs/retros/week-04.md).

### Phase 2 · Week 5 complete — Sandbox, object store, Spec 8

Days 21–25 widened the *storage and isolation* substrate behind the seams Phase
1 declared: a content-addressed `ContentStore` (S3/MinIO `ObjectStoreContentStore`
with an in-memory dev fallback, large snapshots offloaded past a threshold), a
container `SandboxedCheck` for verification with an in-process parity fallback, and
Spec 8 (`docs/core/8_Human_Review_Interface_v0.1.md`) promoted. The **Week-5
checkpoint** (day-25) wired the sandbox-fallback / object-integrity / cache-hit
counters into the offline report so the new infra is *measured*, not just present.

### Phase 2 · Week 6 complete — Harden, A/B dry-run, exit review

Days 26–30 hardened the new infra (failure injection + concurrency), re-ran the
full E2E under the Phase-2 stack, then closed the loop the phase existed to close.
The **Week-6 A/B dry-run** (day-29) ran keyword vs semantic context ranking
head-to-head behind the shadow harness: the ranks genuinely disagree
(`rank_correlation = [-1.0, -1.0]`), the outcome is a toss-up, the guardrail HELD,
and the honest call is *promote to a real A/B, not to the default*.

### Phase 2 complete — metrics checkpoint & `v0.2.0-harness` tag

**Phase 2 is complete** (Days 01–30, tagged `v0.2.0-harness`). The exit review
([`docs/retros/phase2-metrics.md`](docs/retros/phase2-metrics.md)) marks 8 of 9 §7
exit criteria ✓ with the ninth △: routing is measured (precision 0.333 / recall 0.5
/ escalation-leakage 1.0 over N=4), the A/B harness reports a real head-to-head with
no production effect, `rank_method` stays `keyword` by construction, auth + review +
sanbox + object-store + Spec 8/10 are all green — but the fitted attention weights
(log-loss 0.316) did *not* beat the Phase-1 placeholder (0.262), so calibration is
carried into Phase 3 as backlog rather than claimed done. The full record of what
held and what drifted is the [Week-6 retrospective](docs/retros/week-06.md).

Next up: [Phase 3 — Learn & Automate Under Guardrails](docs/plan/phase-3/README.md), starting from the [Phase-3 backlog](docs/plan/phase-3/backlog.md).

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