# HAI Harness — Human-Attention Infrastructure

**AI reviews external pull requests; a human decides.** Paste a PR / MR URL
(+ an optional Jira ticket), and the harness fetches the diff + the requirement,
asks the configured AI provider to review it, and stores a report with findings
and fix suggestions — so a reviewer sees only what actually matters, never the
flood. Every step lands in an append-only event log, so the trail is replayable,
queryable, and auditable.

| | |
| --- | --- |
| **Status** | Review slice shipped · code-generation path retired (`review-reorient`) |
| **Quality gates** | build ✅ · typecheck ✅ · lint ✅ · 616 tests ✅ |
| **Stack** | TypeScript · Fastify · React (Vite) · PostgreSQL 16 (Drizzle) · OpenTelemetry · Docker |
| **Boundary model** | 19 `@harness/*` packages; engines never import another engine |

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
                              WRITE-BACK (Phase 3 — optional comment/status → PR / Jira)
```

Two endpoints carry the slice today (`apps/api/src/routes/reviews.ts`):

- `POST /api/reviews` — paste `{ prUrl, jiraTicket? }`; fetches the PR (GitHub
  today; GitLab/Bitbucket are the Phase-3 providers), fetches the ticket if
  given, asks the AI, and returns the stored report id.
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
- **Next (Phase 3):** verification (clone + run tests in the Docker sandbox),
  attention routing of reviews, write-back to PR/Jira behind a toggle, and the
  GitLab/Bitbucket providers. See the [Phase 3 backlog](docs/plan/phase-3/backlog.md).

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
| **Engines** | `orchestrator`, `agent-runtime`, `context-engine`, `artifact-tracker`, `attention-engine`, `verification-engine`, `review` |
| **Phase-2/3 seams** | `auth`, `embeddings`, `evaluation`, `object-store`, `observability`, `sandbox`, `git-provider`, `ticket-provider` |
| **Shared foundation** | `domain`, `db`, `di`, `event-bus` |

Each package documents its purpose, data model, invariants, and boundary rules in
its own `README.md`.

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

## Status & roadmap

**The code-generation loop is retired** and the **review slice is shipped**
(`POST/GET /api/reviews`). The verification + write-back breadth (clone → run
tests in the Docker sandbox, attention routing of reviews, GitLab/Bitbucket
providers, optional comment/status write-back) is tracked in the
[Phase 3 backlog](docs/plan/phase-3/backlog.md).

The historical record of Phases 1–2 — the measurement loop, calibration, A/B
harness, and the honest exit review — is unchanged and lives in
[`docs/retros/`](docs/retros/).

---

## Documentation

| What | Where |
| --- | --- |
| **Architecture spec** | [`docs/core/`](docs/core/) + one `README.md` per `@harness/*` package |
| **Build plan & backlog** | [`docs/plan/`](docs/plan/README.md) — day-by-day plans (Phases 1–3) and the Phase-3 backlog |
| **Operations runbook** | [`docs/runbook/`](docs/runbook/README.md) — incidents, exact commands, escalation rules |
| **Developer guide** | [`docs/dev-guide.md`](docs/dev-guide.md) — clone-to-green in ~15 minutes |
| **Wiring map** | [`docs/architecture/wiring-map.md`](docs/architecture/wiring-map.md) — the DI object graph |
| **Retrospectives** | [`docs/retros/`](docs/retros/) — honest weekly post-mortems |

## Repository layout

| Path | What's in it |
| --- | --- |
| `packages/` | 19 engines and shared libraries (`@harness/*`) |
| `apps/api` | Fastify API + single DI bootstrap (`bootstrap.ts`) + the review slice |
| `apps/web` | React + Vite review UI |
| `docs/core/` | The architecture overview (subsystem docs live in each package's `README.md`) |
| `docs/plan/` | Day-by-day build plans (Phases 1 / 2 / 3) + backlog |
| `docs/architecture/` | Wiring map and living architecture notes |
| `docs/runbook/` | Audit-query cookbook + operational runbook + limitations |
| `docs/retros/` | Honest weekly retrospectives |