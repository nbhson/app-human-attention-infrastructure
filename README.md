# HAI Harness — Human-Attention Infrastructure

[![CI](https://github.com/nbhson/human-attention-infrastructure-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/nbhson/human-attention-infrastructure-harness/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A5%2020-339933.svg)](package.json)
[![Version](https://img.shields.io/badge/version-v0.3.0--harness-7a3f3f.svg)](https://github.com/nbhson/human-attention-infrastructure-harness/tags)

**AI reviews external pull requests; a human decides.** Paste a PR / MR URL
(+ an optional Jira ticket), and the harness fetches the diff + the requirement,
asks the configured AI provider to review it, and stores a report with findings
and fix suggestions — so a reviewer sees only what actually matters, never the
flood. Every step lands in an append-only event log, so the trail is replayable,
queryable, and auditable.

| | |
| --- | --- |
| **Status** | Feature-complete · tagged `v0.3.0-harness` · review-only control plane (`review-reorient`) |
| **Quality gates** | build ✅ · typecheck ✅ · lint ✅ · 975 unit tests ✅ · 9 e2e ✅ |
| **Stack** | TypeScript · Fastify · React (Vite) · PostgreSQL 16 (Drizzle) · OpenTelemetry · Docker |
| **Boundary model** | 25 `@harness/*` packages; engines never import another engine |

> **Pivot note.** The harness no longer *authors* code. The internal loop — an
> AI agent writing files, committing them, and auto-merging on approval — is
> retired. The product is now a read-only **PR review control plane**: the AI is
> the *reviewer*, not the author. See [§What changed](#what-changed) and the
> [retirement record](docs/plan/phase-3/backlog.md).

---

## What it does

The flow is a single review vertical slice:

```text
 Settings (web UI / env)             New review (web UI)
   Git provider  : token + baseUrl     paste PR URL + Jira ticket (optional)
   Jira          : token + baseUrl
   AI            : provider, key, baseUrl, model
          │                                    │
          ▼                                    ▼
   provider config                          POST /api/reviews { prUrl, jiraTicket }
          │                                    │
          ▼                                    ▼
   GitProvider.fetchPullRequest ──▶ diff + metadata      TicketProvider.fetchIssue ──▶ requirement
                                                    │
                                        create Task (anchor, then CANCELLED)
                                                    │
                                   AI REVIEW (LLM → report + findings[] + fix suggestions[])
                                                    │
                               persist review_reports / review_findings / fix_suggestions
                                                    │
                                          UI shows report + suggestions
                                                    │
                              HUMAN DECISION (approve / request-changes / reject)
                              WRITE-BACK (toggle-gated comment/status → PR / Jira)
```

Two endpoints carry the slice today (`apps/api/src/routes/reviews.ts`):

- `POST /api/reviews` — paste `{ prUrl, jiraTicket? }`; fetches the PR (GitHub,
  GitLab, or Bitbucket via the MCP config), fetches the ticket if given (Jira via
  MCP), asks the AI, and returns the stored report id.
- `GET /api/reviews/:id` — the report, findings, and fix suggestions, ready for
  the UI.

On top of that retained-but-not-yet-wired-into-this-slice machinery sits the
wider pipeline — the canonical task state machine, independent verification
(clone → test in the Docker sandbox), and attention routing:

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

The review slice creates a task purely to anchor the provenance trail and
immediately `CANCELLED` it — the retired dispatcher used to pull `PENDING`/`REWORK`
tasks into the code-gen workflow, and a cancelled task is never consumed.

| Engine | Role |
| --- | --- |
| **Orchestrator** | Owns the Task state machine + `TaskService` (the dispatch/workflow/retry loop is retired) |
| **Agent Runtime** | The read-only **reviewer**: `LLMProvider` + `ReviewAgent` → structured report (the write/`write_file` tools are retired) |
| **Context Engine** | Gathers, ranks, and budgets the context a reviewer sees (exact `tiktoken` tokens) |
| **Verification Engine** | Independent compile + test + sandboxed checks (real tooling) |
| **Attention Engine** | Scores each change and budgets human attention (+ gated auto-approve) |
| **Review** | A human APPROVES / REJECTS every change, with rationale |
| **Artifact Tracker** | Snapshots, diffs, and provenance for every change |

See [the wiring map](docs/architecture/wiring-map.md) for the full object graph.

## Capabilities

| Area | What's shipped |
| --- | --- |
| **Ingest** | Paste a PR/MR URL + Jira ticket; fetch the diff + requirement through the **MCP** config — GitHub / GitLab / Bitbucket / Jira via one `mcp.config.json`, tokens referenced by env var (never inline) |
| **Review** | The configured AI (Anthropic or OpenAI-compatible, `key`+`baseUrl`+`model`) reviews the diff **read-only** → report + findings + fix suggestions |
| **Verify** | Clone into the Docker sandbox and run build/test; dependency-graph targeted verification; a FAILED run *flags* the report, never authors a fix |
| **Attention & decision** | Score + route every review; a human APPROVES / REJECTS; `AUTO_APPROVABLE` stays the only auto-path — gated + sampling-audited |
| **Write-back** | Optional, fail-safe, 3-layer toggle: comment/label/status → PR/MR, comment/transition → Jira; every write lands in `writeback_log`; OFF = nothing external |
| **Memory** | Review / finding / decision memory tiers, distilled + relevance-scored, with consolidation / decay / archive |
| **Quality & learning** | LLM-as-judge (rubric-scored) + inter-judge agreement, a versioned gold corpus, and a closed learning loop feeding decisions + judge signals back into calibration/routing |
| **Observability** | OpenTelemetry tracing + metrics; every step in an append-only `event_log` joined by one `correlation_id` |

## What changed

The `review-reorient` pivot retired the code-generation path and kept everything
that verifies, scores, routes, and records:

- **Retired:** `AgentRunner` (ReAct + write tools), `RuntimePollLoop`,
  `ToolRegistry`, `TrajectoryRecorder`, code-mode/tiers, `Dispatcher`/`DispatchLoop`,
  `WorkflowRunner` + retry taxonomy, `MergeService` / `ReworkService` /
  `GitAdapter` (`applyAndCommit`), `POST /api/tasks`, and the e2e/load scripts.
- **Kept:** the task state machine, `TaskService`, the LLM-provider seam
  (Anthropic + OpenAI-compatible), the **review slice** (`ReviewAgent`,
  `ReviewIngestService`, `GitProvider`, `TicketProvider`), and the full
  verification / attention / review / evidence / observability machinery.
- **Shipped:** MCP connectivity (GitHub/GitLab/Bitbucket/Jira via one
  `mcp.config.json`), Docker-sandbox verification, attention routing, toggle-gated
  write-back to PR/Jira, review memory, LLM-as-judge, and the closed learning
  loop. See the [exit review](docs/retros/phase3-exit-review.md).

## Principles

- **Evidence before confidence** — a claim is not evidence. The harness verifies
  (compile + tests) before anything reaches a human.
- **Human attention is the scarce resource** — the Attention Engine scores and
  budgets approval so reviewers see what matters, never the flood.
- **Full provenance** — every state change, LLM call, and decision lands in the
  append-only `event_log`, joined by one `correlation_id`.
- **Shadow-then-default** — a new signal (semantic retrieval, fitted weights)
  earns the default by winning a measured comparison, never by being newer.
- **No live keys in the repo** — the real provider paths are compile-tested only;
  `.env.example` carries placeholders and execution is sandboxed.

## Packages

| Layer | Packages |
| --- | --- |
| **Foundation** | `domain`, `event-bus`, `di`, `db`, `observability` |
| **Engines** | `orchestrator`, `agent-runtime`, `artifact-tracker`, `verification-engine`, `attention-engine`, `context-engine`, `review`, `auth`, `embeddings`, `evaluation` |
| **Review slice** | `git-provider`, `ticket-provider`, `writeback`, `memory`, `judge`, `benchmark` |
| **Tooling** | `object-store`, `sandbox`, `mcp`, `code-index` |

Each package documents its purpose, data model, invariants, and boundary rules in
its own `README.md`.

## Review-quality measurement

Quality is measured, not claimed. `pnpm benchmark:regression` re-runs a versioned
gold corpus through judge → agreement → refit → A/B and diffs every number against
the recorded Day-25 baseline; `pnpm judge:agreement-report` recomputes inter-judge
and judge-vs-gold agreement **from the audit rows**:

- inter-judge severity / routing agreement **0.920 / 0.945** (κ 1.000, n=6)
- judge-vs-gold severity / routing / usefulness **0.935 / 0.958 / 1.000**

The honesty boundary is stated on the tin: the demo judge is a seeded PRNG, so these
numbers prove the *review-quality math* is regression-free — they do not detect
live-model drift, and `n=6` is a mechanism test, not a signal. See
[docs/retros/phase3-benchmark.md](docs/retros/phase3-benchmark.md).

## Quickstart

```sh
git clone <repo-url> harness-human-attention-infrastructure
cd harness-human-attention-infrastructure
pnpm install                        # links the @harness/* workspace packages
docker compose up -d                # Postgres :5432 · Prometheus :9090 · Grafana :3001 · MinIO :9000
cp .env.example .env                # DATABASE_URL + placeholder provider keys
pnpm --filter @harness/db migrate   # apply migrations
pnpm test                           # unit + integration (~2 min)
pnpm dev                            # run the API + web UI
```

**Requirements:** Node.js ≥ 20, pnpm ≥ 9 (pinned `9.15.4`), Docker. Full walkthrough
in the [Developer Guide](docs/dev-guide.md).

## Status

The harness is feature-complete through **`v0.3.0-harness`** — a review-only control
plane: MCP connectivity (GitHub/GitLab/Bitbucket/Jira via one `mcp.config.json`),
AI review, Docker-sandbox verification, attention routing, toggle-gated write-back,
review memory, and a closed learning loop with an LLM-as-judge quality signal.

Two items are honestly **carried forward** (`EXIT-WITH-CARRYFORWARD`, 8 of 9 exit
criteria): hybrid context ranking as the default (Day-29 A/B returned HOLD) and
auto-applied fitted attention weights. Both are named in the
[backlog](docs/plan/phase-3/backlog.md) (CF-1 / CF-2) with their gates.

The historical record of the build — the measurement loop, calibration, A/B harness,
closed-loop, and the honest exit reviews — lives in [`docs/retros/`](docs/retros/).

---

## Security

Security issues are handled privately, never in public issues — see
[`SECURITY.md`](SECURITY.md). The repo carries **no live API keys or tokens**:
`.env.example` has placeholders only, `.env` is gitignored, tokens are redacted
from logs, and untrusted code (verification) runs only in the Docker sandbox.
Write-back is fail-safe: an external write fires only when the whole toggle chain
is armed.

## Contributing

Bug reports, features, and docs fixes are welcome — see
[`CONTRIBUTING.md`](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
The green gate is `pnpm test && pnpm lint && pnpm e2e`.

## License

[MIT](LICENSE) © 2026 Sơn Nguyễn.

## Documentation

| What | Where |
| --- | --- |
| **Architecture spec** | [`docs/architecture/`](docs/architecture/) + one `README.md` per `@harness/*` package |
| **Build plan & backlog** | [`docs/plan/`](docs/plan/README.md) — day-by-day build history + backlog |
| **Operations runbook** | [`docs/runbook/`](docs/runbook/README.md) — incidents, exact commands, escalation rules |
| **Developer guide** | [`docs/dev-guide.md`](docs/dev-guide.md) — clone-to-green in ~15 minutes |
| **Wiring map** | [`docs/architecture/wiring-map.md`](docs/architecture/wiring-map.md) — the DI object graph |
| **Retrospectives** | [`docs/retros/`](docs/retros/) — honest weekly post-mortems |

## Repository layout

| Path | What's in it |
| --- | --- |
| `packages/` | 25 engines and shared libraries (`@harness/*`) |
| `apps/api` | Fastify API + single DI bootstrap (`bootstrap.ts`) + the review slice |
| `apps/web` | React + Vite review UI |
| `docs/plan/` | Day-by-day build history + backlog |
| `docs/architecture/` | Architecture spec, wiring map, and living architecture notes |
| `docs/runbook/` | Audit-query cookbook + operational runbook + limitations |
| `docs/retros/` | Honest weekly retrospectives |