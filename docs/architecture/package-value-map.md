# Package Value Map — 25 packages, 3 groups

> **Living document.** Companion to [`wiring-map.md`](wiring-map.md) (DI graph) and
> [`runtime-startup.md`](runtime-startup.md) (what loads at boot). This file answers
> a different question: **which package produces a value the user can see, which only
> produces value when conditions are met, and which is purely foundational?**
>
> **Status:** v1.0-candidate · 25 `@harness/*` packages + 2 apps.

## How to read this

**Import ≠ value.** A package registered in the DI container is just "code present in
the process." Value is only realized when it **runs and the user gets something** —
a finding displayed on the report page, a PR actually fetched, a comment written
back to a PR. Using that criterion, the 25 packages are split into 3 groups:

| Group | Criterion | # packages |
| --- | --- | --- |
| **A — Direct value** | Runs on the current `paste PR → review` flow; the user sees the result | **5** |
| **B — Conditional value** | Real value, but only activates when corresponding conditions are met (currently imported but not running, or running "orphaned") | **12** |
| **C — Infrastructure** | Foundation for A and B; doesn't produce value on its own; all other groups stand on it | **8** |

### Group A — User-visible direct value

These are what make the app stand out from "paste into ChatGPT". If you remove any
one of these 5 packages, the product breaks immediately.

| Package | What the user sees | When it runs |
| --- | --- | --- |
| `agent-runtime` | `ReviewAgent` produces **summary / findings / verdict** displayed on the report page | Every `POST /api/reviews` |
| `git-provider` | Turns pasted URL into an **actual PR** (diff, files, title) — without it, "paste PR" is meaningless | Every ingest |
| `ticket-provider` | Pulls in **Jira requirements** into the prompt (optional) | When `jiraTicket` is present |
| `review` | **Queue + decision flow** — list page + APPROVE/REQUEST_CHANGES/REJECT decision bar | Read/write report |
| `writeback` | **Comment + status written back to PR** (outside the app, on GitHub) | When APPROVE/REJECT + toggle ON |

> On **these same 5 packages**, the trust-loop (finding `verified`/`unverified`) is a
> pure function in `apps/api/src/finding-anchor.ts` — it answers "is the AI fabricating
> lines?" without needing any additional package.

### Group B — Conditional value (real value, not yet enabled)

Each package here has its own value, but that value **only materializes when the
condition in the middle column is satisfied**. In the current state (1 PR / 1 person,
cold repo), they are either "imported but not running" or running orphaned.

| Package | Condition to produce value | Current state |
| --- | --- | --- |
| `verification-engine` | Wired into review flow + `GITHUB_TOKEN` + repo has test suite | Imported, **not called** |
| `attention-engine` | **Scale**: multiple PRs / multiple reviewers for routing + fatigue to matter | Subscribed but happy path `AWAITING_REVIEW` never runs (task is CANCELLED immediately) |
| `artifact-tracker` | Flow must **produce an artifact** (after verification runs) | Subscribed but no `artifact.created` |
| `context-engine` | Needs **repo index corpus** for collect→rank→trim to have something to read | Review flow assembles prompt itself, does not use it |
| `memory` | **Warm repo**: has repeated review history so "past decisions inform new reviews" | Read wired, **write not wired** |
| `embeddings` | **Large repo** needs semantic search (keyword path is sufficient for small repos) | Stub default, keyword path not read |
| `judge` | Needs **rubric baseline** + must surface `judge_runs` to UI | Runs shadow but **log-only**, not visible |
| `evaluation` | Needs **corpus + time** to measure review quality over time | Offline — correct placement |
| `object-store` | Needs `OBJECT_STORE_ENDPOINT` (S3/MinIO) + has artifacts to offload | In-memory fallback, offload disabled |
| `sandbox` | Needs `VERIFY_SANDBOX_ENABLED=1` + Docker | Only `CompileCheck` in-process |
| `code-index` | Wire **in-process** to select the correct test for verification | CLI-only (demo script) |
| `benchmark` | Needs **corpus regression** to compare quality across versions | CLI-only (out-of-band) |

**Key insight:** Group B splits into 2 tiers —

1. **Need to wire into the flow** (`verification-engine`, `attention-engine`,
   `artifact-tracker`, `memory`, `code-index`): value lies in the wiring, costs vary.
   `verification-engine` is the most expensive (clone + sandbox + handle non-testable
   repos); `attention-engine` is nearly free (pure score function, already tested).
2. **Already in the right place** (`evaluation`, `benchmark`): offline is its nature,
   not part of the hot path — do not touch.

### Group C — Infrastructure (foundational, does not self-produce value)

No package in Group C produces independent value; they are the **foundation** that A
and B stand on. The "25 packages" problem largely lives here — and this is where
modular-monolith intentionally chooses many small seams to keep boundary rules
(R1–R14) enforceable at compile time.

| Package | Role |
| --- | --- |
| `domain` | Branded ID, aggregate, event vocabulary, `TaskStatus`, `ReviewDecisionType` |
| `event-bus` | `IEventBus` (in-process / optional Redis) |
| `di` | `Container`, `TOKENS`, `createRootLogger` |
| `db` | Drizzle schema (49 tables) + `EventLogWriter` |
| `observability` | OpenTelemetry tracing + Prometheus metrics |
| `auth` | OIDC identity + roles + `SessionService` (route guard) |
| `mcp` | `McpServerRegistry` + generic client — **foundation** for `git-provider`/`ticket-provider` |
| `orchestrator` | `TaskStateMachine` + `TaskService` (create/cancel **anchor task**; code-gen portion retired) |

## Bottom line

```
5  packages produce what the user sees       → this is the "product"
12 packages poised to create value when conditions met → this is "latent differentiation" (imported, not running)
8  infrastructure packages                   → this is the "modular foundation"
```

The real question is not "delete or keep" but **which Group B packages are worth
wiring into the flow today**. Per [`runtime-startup.md`](runtime-startup.md), only
~16/25 packages run on the hot path; the remaining 9 packages (Group B minus
`evaluation`/`benchmark`) are "imported but idle" — correctly isolated by this table.

## Cross-references

- [`wiring-map.md`](wiring-map.md) — token-by-token DI graph + R1–R14 table.
- [`runtime-startup.md`](runtime-startup.md) — what loads at boot, 11 eager tokens.