# Day 29 — Documentation: Specs v0.2, Dev Guide & Runbook

| **Week** | Week 4 — Human Loop & E2E |
| --- | --- |
| **Spec refs** | All (Specs 1–7 → v0.2) |
| **Estimated effort** | 1 day |
| **Prerequisites** | Day 28 (hardening complete — docs must describe the system as it actually behaves, not as it was imagined) |

---

## 1. Objectives

1. Bump all 7 core specs from **v0.1 → v0.2**, reconciling every place where 30 days of building diverged from what was written.
2. Write the **Developer Guide**: from `git clone` to a passing `pnpm e2e` in under 15 minutes.
3. Write the **Operations Runbook**: startup/shutdown, common incidents with exact commands, DB intervention procedures, and escalation rules.
4. Update the top-level README so a stranger understands what this is in 60 seconds.

> **Why this matters:** The specs were written before a line of code existed; the code now knows things the specs don't (the reconciler, `task.orphan_recovered`, the flaky retry-once rule's real edge cases, actual table names). Documentation that lags implementation becomes anti-documentation — it teaches wrong mental models with an authoritative voice. Today the docs catch up, and we institutionalize the rule: **a PR that changes behavior without updating its spec is incomplete.**

---

## 2. Design Decisions

### 2.1 Spec v0.2 reconciliation process

For each of the 7 specs, do a structured diff-review:

1. **Walk the implementation** package-by-package with the spec open.
2. Classify every divergence into one of three buckets:
   - **Spec was wrong** → update spec (most common; e.g. details refined during Days 6–24)
   - **Code is wrong** → file a Phase-2 ticket; do NOT silently edit the spec to match a bug
   - **Legitimate Phase-1 deferral** → mark in spec as `Phase 2+` explicitly (several already are: semantic ranking, targeted verification, auto-approve)
3. Add a `## Changelog` section at the bottom of each spec:

```markdown
## Changelog

### v0.2 (Day 29)
- Added `task.orphan_recovered` event and startup reconciler behavior (§7)
- Clarified: `attempt_number` increments ONLY on REWORK→QUEUED (§5) — was ambiguous
- Documented `correlation_id` columns added in migration 0023
- Marked targeted/incremental verification strategies as Phase 3 (was implied)
```

Known reconciliation items (compiled from Days 1–28 — verify each, there will be more):

| Spec | Item |
| --- | --- |
| 1 Architecture | Add reconciler to component list; ops endpoints; `docs/runbook/` in repo layout |
| 2 Orchestrator | `task.orphan_recovered` event; PROCESS_DIED transition reason; reconciler's startup ordering constraint |
| 3 Runtime | Actual `AGENT_MAX_STEPS` default (10); token-budget → RESOURCE classification as built |
| 4 Context | `rank_method = 'phase1-keyword-dependency'` string as shipped; freshness_events metadata shape |
| 5 Artifacts | Confirm MERGED/ROLLED_BACK transitions match ChangeStatusSubscriber as built |
| 6 Attention | Weights remain placeholders (0.35/0.25/0.15/0.10/0.15) — state explicitly "untuned, do not tune without data"; threshold-adjustment bounds [0.60, 0.80] as built |
| 7 Verification | Flaky retry-once rule as built; 64KB output cap; sanitizedEnv() key list |

### 2.2 Developer Guide (`docs/dev-guide.md`)

Structure — optimized for "new laptop, new engineer, 15 minutes":

1. **Prerequisites** — Node 20+, pnpm 9+, Docker. Nothing else.
2. **Setup** (must be exactly this, verified today on a clean checkout):
   ```bash
   git clone <repo> && cd harness-human-attention-infrastructure
   pnpm install
   docker compose up -d
   pnpm db:migrate
   pnpm test          # unit + integration, ~2 min
   pnpm e2e           # full vertical slice, <3 min
   ```
3. **Repo tour** — the package table from the plan README, one line each, plus "where do I change X?" index (state machine → Spec 2 + `packages/orchestrator`; scoring → `packages/attention-engine`; etc.)
4. **Daily workflow** — `pnpm dev`, `pnpm db:reset`, how to run a single package's tests, how to add a migration (naming: `NNNN_topic.sql`, never edit applied migrations)
5. **Architecture rules** — R1–R6 dependency rules with the eslint-boundaries error you'll see if you break one, and the "engines never import engines" rationale in two sentences
6. **Testing philosophy** — real DB for integration (harness_test schema), MockLLM for agent tests, no mocks across package boundaries, why concurrency tests use barriers not sleeps

**Verification:** have someone (or a clean VM/container) follow the guide with no other context. Every stumble = a guide bug. Fix and re-run.

### 2.3 Operations Runbook (`docs/runbook/README.md`)

Incident-oriented, not component-oriented. Each entry: **Symptom → Diagnose (exact command) → Resolve (exact command) → Escalate when.**

| # | Incident | Key content |
| --- | --- | --- |
| R1 | Task stuck in EXECUTING | Q8 orphan query; check API process alive; if process died, restart → reconciler recovers; if alive, check `agent_runs.current_step` + logs by correlation_id |
| R2 | Review queue not draining | Check `/api/ops/metrics` queue depth; verify reviewers exist; check daily budget (Day 19) hasn't deferred items — query `review_queue` for `DROPPED`/deferred |
| R3 | Verification always times out | Q2 dwell query on VERIFYING; check worktree disk space; check `verification_check_results` for TIMED_OUT pattern; raise per-check timeout only with evidence |
| R4 | LLM costs spiking | Q6 cost query; check `retry_log` for retry storms; check max-steps escalations; verify TokenBudget config |
| R5 | Alert fatigue signals | Q4 + Q5; if inflation_detected recurring → thresholds auto-adjusting is working; if usefulness < 50% on HIGH for 2 weeks → escalate to policy review (human decision, not code) |
| R6 | DB intervention (manual state fix) | **Last resort.** Procedure: stop API → psql transaction with explicit `UPDATE tasks SET state=... WHERE id=... AND state=...` → insert matching `task_state_history` row with reason `MANUAL_INTERVENTION` + your name → insert `event_log` row → restart. Never skip the history row. |
| R7 | Full reset (dev only) | `pnpm db:reset` — destroys everything; never in any shared environment |
| R8 | Startup/shutdown | `docker compose up -d` / `pnpm dev`; SIGTERM drains loops (Day 8); SIGKILL is safe due to reconciler but loses in-flight LLM calls |

Plus links: audit-queries.md (Day 27), limitations.md (Day 28), wiring-map.md.

### 2.4 Top-level README

60-second pitch structure:

1. **What** — one paragraph: control plane for human attention in AI-native development; AI produces work, harness verifies/evidences/routes to humans
2. **Principles** — Evidence before confidence; Claim ≠ Evidence; full provenance (3 bullets, no more)
3. **Status** — Phase 1 complete (30-day build); what works (link dev guide), what's deferred (link Day-30 backlog)
4. **Quickstart** — the 6 commands from §2.2
5. **Map** — links: specs (docs/core), build plan (docs/plan), runbook, dev guide

---

## 3. Tasks

### 3.1 Spec reconciliation (3h)
- [ ] Walk all 7 specs against code; classify divergences (wrong-spec / wrong-code / deferred)
- [ ] Apply spec edits; add Changelog sections; bump headers to v0.2
- [ ] File Phase-2 tickets for any wrong-code findings

### 3.2 Dev guide (2h)
- [ ] Write `docs/dev-guide.md` per §2.2
- [ ] Clean-environment verification run; fix every stumble

### 3.3 Runbook (2h)
- [ ] Write `docs/runbook/README.md` with R1–R8, linking audit-queries.md and limitations.md
- [ ] Actually execute R1, R6 (on a disposable task), R7 to verify commands work as written

### 3.4 README + sweep (1h)
- [ ] Rewrite top-level README per §2.4
- [ ] Link sweep: every doc referenced from plan/specs exists; no dangling links (script or manual grep)
- [ ] Update `docs/architecture/wiring-map.md` final state

---

## 4. Deliverables

| File | Description |
| --- | --- |
| `docs/core/1..7_*_v0.2.md` (or versioned headers) | All 7 specs reconciled with implementation, changelogs added |
| `docs/dev-guide.md` | Clone-to-green in 15 minutes |
| `docs/runbook/README.md` | Incident runbook R1–R8 |
| `README.md` (root) | 60-second pitch + quickstart + map |
| Phase-2 tickets | For every wrong-code divergence found during reconciliation |

---

## 5. Acceptance Criteria

- [ ] All 7 specs at v0.2 with Changelog sections; zero known spec/code divergences unaccounted for (each is fixed, ticketed, or marked Phase 2+)
- [ ] A clean checkout + dev guide alone produces passing `pnpm test && pnpm e2e` with no tribal knowledge
- [ ] Every runbook command (R1–R8) executed at least once against the real stack today
- [ ] R6 manual-intervention procedure leaves a complete audit trail (history row + event) — verified by Q1/Q2 queries
- [ ] No dangling links across README, specs, plan, runbook, dev guide
- [ ] `pnpm test && pnpm lint && pnpm e2e` green (docs day doesn't break code — prove it)

---

## 6. Notes & Pitfalls

- **Don't document aspirations.** If the runbook says "restart the worker pool" and there is no worker pool, you've written a trap. Every command in R1–R8 gets executed today precisely to prevent this.
- **The spec changelog is a trust device.** Future readers (including future you) need to know v0.1 was a plan and v0.2 is ground truth. Without changelogs, people diff mentally and get it wrong.
- **Resist documenting Phase 2 in the specs.** Deferred features get one line ("Phase 2+: semantic ranking") and a pointer to the backlog — not a full design. Specs describe what IS; the backlog describes what MIGHT BE.
- **The dev guide's 15-minute budget is a feature.** If setup takes 45 minutes, the guide isn't the problem — the setup is. Note friction for the Phase-2 backlog (e.g. `pnpm setup` meta-script) rather than writing a longer guide.
- **Next:** [Day 30 — Final Demo, Retrospective & Phase 2 Backlog](day-30.md).

---

*Prev: [Day 28 — Hardening: Concurrency, Failure Injection & Load Smoke](day-28.md) | Next: [Day 30 — Final Demo, Retrospective & Phase 2 Backlog](day-30.md)*
