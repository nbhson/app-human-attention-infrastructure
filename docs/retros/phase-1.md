# Phase 1 Retrospective — 30 Days of HAI Harness

> Blameless, numbers-first. The scoreboard section deliberately includes the slips
> and the gap — a retro without the uncomfortable numbers is marketing.

## 1. Plan vs. actual

All 30 days completed and committed to `main` (one commit per day). No day was
dropped; a handful changed scope in place, which the daily table records as `⚠️`
rather than a slip date:

| Signal | What actually happened |
| --- | --- |
| Day 11 `⚠️` | LLM adapter shipped, but CI/E2E runs a **scripted `MockLLM`** — the real Anthropic path is compile-tested only (no live key in the repo, by policy). |
| Day 13 `⚠️` | Three sandbox tools built (`read_file`/`write_file`/`list_directory`); `run_command` was **deferred** to Phase 2 (untrusted shell is a Phase-3 sandbox concern). |
| Day 16–21 `⚠️` | Trust pipeline shipped end-to-end, but `Attention` weights stay **placeholders** and `AUTO_APPROVABLE` sets a flag nobody acts on — both deliberate, gated on Phase-2 calibration. |
| Day 27–28 `⚠️` | Observability + hardening shipped, but the "≥ 70% coverage" exit criterion was **not measured** — coverage tooling was never wired (see scoreboard gap). |

The `⚠️` markers are therefore *built-with-deferred-sub-items*, not unbuilt days.
Every day's deliverable is real, tested, and pushed.

## 2. The scoreboard

| Metric | Value |
| --- | --- |
| Tests | **351** passing, across **86** files (Vitest, unit + integration) |
| Workspace packages | **11** `@harness/*` + `apps/api` + `apps/web` |
| Database tables | **25** |
| Migrations | **14** (drizzle-generated `NNNN_<slug>.sql`) |
| Canonical event types | **15** |
| Task states | **13** |
| E2E | happy path + **8** failure scenarios, **~14 s** wall-clock (green, 3/3) |
| Load smoke | **50** tasks → correct terminal states; p50 **3.87 s**, p95 **6.98 s**, wall-clock **18.3 s**, **0** orphans, 215 LLM calls, 495 event-log rows |
| Hardening suites | **C1–C7** (concurrency) + **F1–F5** (fault injection) — all green |
| Coverage | **not measured** (no `@vitest/coverage-v8`, no coverage config) — *gap, backlogged* |

**Bugs the hardening + demo days caught before they hurt anyone:**

- **C3/C4/C5** proved the guarded-write discipline: double-dispatch, double-claim,
  and double-decide all resolve to exactly one winner (the rest 409/state-error).
- **F1/F5** proved crash-safety: a dropped connection mid-transition and a dead
  dispatcher both leave the task recoverable, never duplicated.
- **F4** proved the startup reconciler escorts an orphan stranded by `SIGKILL` to
  `AWAITING_HUMAN_INTERVENTION` (`task.orphan_recovered`).
- **Day-30 dress rehearsal** caught an e2e *flakiness* (not a product bug): the
  happy-path driver asserted the routed review-queue item **once**, racing the
  fire-and-forget `AttentionRouter` (which enqueues a hop after the assessment row
  commits). Fixed by polling the queue item the way the assessment was already
  polled — three consecutive green runs afterwards.

## 3. Three keep / three change

**Keep**

1. **Postgres as the concurrency primitive.** `FOR UPDATE SKIP LOCKED`, guarded
   `UPDATE … WHERE state = from`, and unique idempotency keys carried every
   concurrency guarantee — no bespoke locking layer needed.
2. **Spec-first workflow.** Writing v0.1 specs before code meant the reconciliation
   exercise (Day 29) was a *diff*, not a rewrite; the changelog is now a trust
   device for future readers.
3. **Fail-toward-human defaults.** Every "unknown" path (all-unavailable factors →
   `HIGH`, flaky evidence → `REVIEW_REQUIRED`, crash → reconcile to a human) routes
   attention *toward* a human, never silently auto-approving.

**Change**

1. **Wire coverage from day 2.** The ≥70% criterion was unverifiable at the finish
   line because the tooling was never installed; measuring early is cheap,
   retrofitting is not.
2. **Pre-empt e2e races with poll-don't-assert.** The one "assert-once after a
   fire-and-forget producer" is exactly the kind of flake that only bites on a
   demo day.
3. **Freeze the meta-scripts early.** `pnpm db:migrate` / `pnpm setup` lived in the
   plan but never got wired, so the dev guide had to document the real filter
   commands and add a backlog note — avoidable with a Day-1 script.

## 4. Spec quality review

Which v0.1 spec needed the most v0.2 reconciliation is a signal about where
upfront design helped vs. guessed.

- **Spec 2 (Orchestrator) — most changed.** The startup reconciler, the
  `task.orphan_recovered` event, and the `PROCESS_DIED` reason were *discovered*
  during Day-28 hardening, not anticipated in v0.1. Up-front design was good at
  the state machine; weaker at crash-recovery semantics.
- **Specs 1 / 6 / 7 — medium.** Architecture (ops surface, runbook), Attention
  (weights *explicitly* placeholders + threshold bounds), and Verification
  (`sanitizedEnv` list, 64 KB cap) each gained concrete as-built detail.
- **Specs 3 / 4 / 5 — light.** Mostly pinning constants as shipped (`max_steps=10`,
  `rank_method='phase1-keyword-dependency'`, the `ChangeStatusSubscriber`
  transitions).

Takeaway: the plan's *steady-state* behaviour (state machine, scoring model,
verification checks) was designed well in advance; the *failure-and-recovery*
behaviour had to be learned.

## 5. Attention-economics sanity check

The harness's own build was, itself, a test of the thesis: an agent producing a
change, a human reviewing it. Review effort actually went where the Attention
Engine would predict — **flaky paths and failure paths** (verification fails,
retries, escalations) absorbed disproportionate human attention relative to their
line count, while the happy path was reviewed once and merged. That is the exact
asymmetry the scoring model encodes (risk first, novelty last). The honest caveat:
the weights that encode that ordering are still hand-picked placeholders, so this
is narrative support, not calibration evidence. Phase 2's first data-driven job is
to fit them from the `was_useful` column the decision loop now collects.

---

*Follows [wiring-map](../architecture/wiring-map.md) and the
[Day-30 backlog](../plan/phase-2-backlog.md). Companion: the weekly retrospectives
in this directory.*