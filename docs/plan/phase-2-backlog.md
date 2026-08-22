# Phase 2 Backlog

Prioritized by **trust-leverage** — does it make human attention better spent? —
not by coolness. Each item is one paragraph: what it is, a rough size, and the
Phase-1 evidence that motivates it. The P0/P1 items are non-negotiable ordering:
they gate everything below them.

> Companion to `docs/plan/phase-2/` (the day-by-day plan) and
> `docs/retros/phase-1.md` (the numbers). This is the *what-and-why* census; the
> plan is the *when-and-how*.

## P0 — must exist before anything else is trusted in shared use

| Item | Size | Motivation from Phase 1 |
| --- | --- | --- |
| **Real authn/authz** (SSO/OIDC, reviewer roles) | M | Identity is a single `X-Reviewer-Id` header (or `reviewerId` body field) with a `reviewer-1` default — demo-grade. The audit trail (`decisions.reviewer_id`, `claimed_by`) only means something if identity is real; any shared deployment needs it first. |
| **Attention weight calibration** | M | Weights are explicit placeholders (`0.35/0.25/0.15/0.10/0.15`). The `was_useful` column now has real data (decision flow records it); Phase 2 fits the weights from it, with a before/after `inflation_detected` comparison. Gating principle: *confidence without evidence is the exact failure this system exists to prevent*. |
| **Coverage tooling** | S | The Phase-1 exit criterion "≥ 70% line coverage" was **never measurable** — no `@vitest/coverage-v8`, no coverage config. Install the provider, wire a threshold, and make the number real before claiming it again. |

## P1 — trust-leverage on the core loop

| Item | Size | Motivation from Phase 1 |
| --- | --- | --- |
| **Auto-approve for `AUTO_APPROVABLE`** (behind flag + sampling audit + kill-switch) | M | `r5` currently sets a flag nobody acts on; the `review_queue.action` column carries the intent but no transition consumes it. Enable only after P0 calibration shows LOW-label `usefulness ≥ threshold`. |
| **Semantic ranking in the Context Engine** | L | `rank_method = 'phase1-keyword-dependency'` works but misses synonyms/related concepts. The `Ranker` seam and the `rank_method` column already version the switch — install embeddings in **shadow mode** (log, don't default). |
| **OpenTelemetry tracing** | M | `correlation_id` answered every Phase-1 "what happened" question; it cannot answer *cross-process latency* (the Q2 dwell gaps — where did the time go *inside* a phase). Spans ↔ `correlation_id` fill that hole. |

## P2 — clear wins, not gates

| Item | Size | Motivation from Phase 1 |
| --- | --- | --- |
| **Targeted / incremental verification** | L | Full-suite verification is the p95 latency driver in the load smoke; Spec 7 already phase-gates dependency-graph test selection. |
| **`requestAdditionalContext` agent tool** | S | Agents cannot ask for more context mid-run; the Context Engine seam exists. Trajectory evidence (`trajectory_steps`) would surface the request clearly. |
| **Multi-repo / monorepo-target support** | L | `SANDBOX_ROOT` assumes one repo tree; real orgs have many. |

## P3 — hygiene and promotion, not urgency

| Item | Size | Motivation from Phase 1 |
| --- | --- | --- |
| **Containerized verification (and code-mode) sandbox** | L | In-process `tsc`/`vitest` with `sanitizedEnv` is Phase-1-appropriate; untrusted code execution needs isolation before it's anything else. |
| **Performance baseline + tuning** | M | Load-smoke numbers (p50/p95) are **observations, not SLAs** — deliberately recorded, deliberately untuned. Tune only against a real workload. |
| **Specs 8–10 formalization + the cov meta-script** | M | Human Review Interface (8), Memory/Evidence (9), Observability/Governance (10) exist as built reality + runbook sections; promote to standalone specs when Phase 2 changes them. Fold in the missing `pnpm setup` / `pnpm db:migrate` meta-scripts (flagged in the dev guide). |

## Explicitly out of scope (non-goals, restated)

Multi-tenant SaaS, a plugin marketplace, a chatbot to replace the review UI, and
"one more feature" merged after `v0.1.0-harness` — that tag is a stable line;
anything after it is Phase 2 by definition.