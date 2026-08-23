# Day 30 — Final Demo, Retrospective & Phase 2 Backlog

| **Week** | Week 4 — Human Loop & E2E |
| --- | --- |
| **Spec refs** | All |
| **Estimated effort** | 1 day |
| **Prerequisites** | Day 29 (docs final), Day 25–26 (E2E suite — the demo IS the E2E, performed live) |

---

## 1. Objectives

1. Perform the **final demo**: a live, scripted end-to-end run proving every Day-30 success criterion from the plan README — on a clean stack, in front of stakeholders.
2. Run the **retrospective**: what the 30 days actually produced vs. what was planned, with numbers.
3. Produce the **Phase 2 backlog**: prioritized, sized, and honest about which Phase-1 decisions need revisiting.
4. Tag the release: `v0.1.0-harness` — Phase 1 is done.

> **Why this matters:** A 30-day build without a closing ritual doesn't end — it fades. The demo converts "we built a thing" into shared, witnessed evidence (fitting, for a system whose first principle is *evidence before confidence*). The retro converts experience into institutional memory. The backlog converts "someday" into a queue. And the tag draws the line that lets Phase 2 start clean instead of accreting onto Phase 1's momentum.

---

## 2. Design Decisions

### 2.1 The demo script (45 minutes, live, clean stack)

The demo is `pnpm e2e` performed by a human, narrated. No slides until the end — the system is the slide.

**Act 0 — Setup (2 min, done before audience arrives):**
```bash
docker compose down -v && docker compose up -d
pnpm db:reset && pnpm db:migrate
pnpm dev   # API + web
```
Clean slate. The audience watches from an empty queue.

**Act 1 — The happy path (10 min):**
1. Create a task via UI/API: *"Fix the greeting bug in fixtures/demo — `greet('world')` returns the wrong string; the test `greeting.test.ts` must pass."*
2. Narrate the pipeline as it happens, switching between the web UI and `psql` running Day-27 queries live:
   - COLLECT_CONTEXT → show `context_snapshots` row, sources + content hashes
   - EXECUTE → show trajectory steps appearing; LLM calls in `llm_call_log` (request_hash, tokens)
   - VERIFY → show `verification_reports` PASSED, then click an **evidence link** in the review UI and open the raw check output — *"Claim ≠ Evidence: the badge is one click from its proof"*
   - ATTENTION → show the assessment row: factors, weights, label HIGH, rule `r2-high`
3. Open `/review`: the item appears with its WHY THIS ITEM panel. Claim it. Show the diff viewer.
4. Approve with rationale + `wasUseful=true`. Watch: merge → commit_sha → task COMPLETED → artifacts MERGED.
5. Open `/tasks/:id/provenance` — the full 7-section chain, event timeline at the bottom. *"Every claim you just saw, reconstructed from the database."*

**Act 2 — The failure paths (15 min):** (pre-seeded fixtures, run live)
1. **Verification failure → rework:** submit the buggy-fix task; watch FAILED → REWORK → attempt 2 with the rejection rationale visible in the agent's next prompt (MockLLM calls record) → PASSED.
2. **Flaky test:** run the flaky fixture; show FLAKY status, report PASSED with `flaky: true`, and routing to REVIEW_REQUIRED via rule `r3` despite the pass. *"The system distrusts flaky evidence exactly as much as you do."*
3. **Agent escalation:** run the max-steps fixture; show ESCALATED + AWAITING_HUMAN_INTERVENTION. *"When the agent flails, the harness spends human attention deliberately — that's the product."*
4. **Concurrency proof:** run C4 live (two reviewers, one item, `Promise.all`) — one 200, one 409.
5. **Kill test:** SIGKILL the API mid-execution, restart, watch the reconciler recover the orphan to AWAITING_HUMAN_INTERVENTION with `task.orphan_recovered` in the event log.

**Act 3 — The numbers (10 min):**
- Day-28 load-smoke summary table (50 tasks, p50/p95, scenario breakdown)
- Q5 usefulness ratio, Q4 alert-fatigue monitor, Q6 cost — run live against the demo DB
- `docs/runbook/limitations.md` — say the Phase-1 ceilings out loud: single node, no auto-approve, placeholder weights

**Act 4 — Close (8 min):** retro highlights + Phase 2 backlog tour + tag the release.

**Demo insurance policy:** record a full rehearsal the day before. If the live demo crashes unrecoverably, play the recording and debug live afterward — honesty about a crash is on-brand for this system; a faked demo is not.

### 2.2 Retrospective format (60 min, written output in `docs/retro/phase-1.md`)

Structure — blameless, numbers-first:

1. **Plan vs. actual** — walk the 30-day table: which days landed on time, which slipped, which changed scope. For each slip: one sentence on *why* (estimate wrong / discovery / spec gap).
2. **The scoreboard:**
   - Test count + coverage by package
   - Migrations shipped (23+), tables, event types
   - E2E wall-clock, load-smoke p50/p95
   - Bugs found by hardening day (C1–C7, F1–F5) — the ones that would have been production incidents
3. **Three keep / three change** — e.g. *keep:* Postgres-as-concurrency-primitive, spec-first workflow, daily acceptance criteria. *Change:* whatever actually hurt (candidates: hand-rolled migrations past ~20 files, MockLLM script ergonomics, single-package-per-engine boilerplate).
4. **Spec quality review** — which v0.1 specs needed the most v0.2 reconciliation? That's a signal about where upfront design helps vs. where it guesses.
5. **Attention-economics sanity check** — did the harness's own build process validate the thesis? (You reviewed its outputs constantly; note where review effort actually went vs. where the Attention Engine would have predicted.)

### 2.3 Phase 2 backlog (`docs/plan/phase-2-backlog.md`, superseded by `docs/plan/phase-3/backlog.md`)

Prioritized by **trust-leverage** (does it make human attention better spent?), not by coolness. Each item: one paragraph + rough size (S/M/L) + what Phase-1 evidence motivates it.

| Priority | Item | Size | Motivation from Phase 1 |
| --- | --- | --- | --- |
| P0 | **Real authn/authz** (SSO/OIDC, reviewer roles) | M | `X-Reviewer-Id` header is a demo-grade placeholder; any shared deployment needs identity for the audit trail to mean anything |
| P0 | **Attention weight calibration** | M | Weights are explicit placeholders; Q5 usefulness data now exists to fit them — first data-driven tuning, with before/after inflation-monitor comparison |
| P1 | **Auto-approve for AUTO_APPROVABLE** (behind flag, with kill-switch + sampling audit) | M | r5 currently sets a flag nobody acts on; enable only after P0 calibration shows LOW-label usefulness ≥ threshold |
| P1 | **Semantic ranking in Context Engine** (embeddings; Ranker interface is the seam) | L | Keyword+dependency ranking works but misses synonyms/related concepts; `rank_method` column already versions the switch |
| P1 | **OpenTelemetry tracing** | M | correlation_id answered Phase-1 questions; cross-process latency questions (Q2 dwell gaps) need spans |
| P2 | **Targeted/incremental verification** | L | Full-suite verification is the p95 driver in load smoke; Spec 7 already phase-gates this |
| P2 | **`requestAdditionalContext` agent tool** | S | Agents currently can't ask for more context mid-run; Context Engine seam exists |
| P2 | **Multi-repo / monorepo-target support** | L | SANDBOX_ROOT assumes one repo; real orgs have many |
| P3 | **Containerized verification sandbox** | L | In-process tsc/vitest with sanitizedEnv is Phase-1-appropriate; untrusted code execution needs isolation |
| P3 | **Performance baseline + tuning** | M | Load-smoke numbers recorded but deliberately untuned; tune against real workload, not the smoke fixture |
| P3 | **Specs 8–10 formalization** (Human Review Interface, Memory/Evidence, Observability as full specs) | M | They exist as built reality + runbook sections; promote to spec status when Phase 2 changes them |

Explicitly **not** in the backlog (non-goals, restated): multi-tenant SaaS, plugin marketplace, replacing the review UI with a chatbot.

### 2.4 Release tagging

```bash
git tag -a v0.1.0-harness -m "Phase 1: 30-day harness build — full pipeline, human loop, E2E proven"
git push origin v0.1.0-harness
```

Tag message body lists: spec versions (all v0.2), migration count, test count, load-smoke summary. The tag is the retro's artifact anchor.

---

## 3. Tasks

### 3.1 Demo prep (2h)
- [ ] Rehearse the full script once end-to-end; record it
- [ ] Prepare the demo fixtures (buggy-fix, flaky, max-steps) as one-command seeders
- [ ] Pre-write the psql queries in a cheat-sheet file (no live typos)

### 3.2 Demo (1h)
- [ ] Perform Acts 0–4 live
- [ ] Collect audience questions verbatim — they are Phase-2 backlog input

### 3.3 Retrospective (2h)
- [ ] Write `docs/retro/phase-1.md` per §2.2 with real numbers
- [ ] 30-min team discussion; amend the doc with dissent where it exists (don't launder disagreement into consensus)

### 3.4 Backlog + release (2h)
- [ ] Write `docs/plan/phase-2-backlog.md` per §2.3 (superseded → `docs/plan/phase-3/backlog.md`); file P0/P1 items as tickets
- [ ] Tag `v0.1.0-harness`; update root README status badge/section
- [ ] Final green run: `pnpm test && pnpm lint && pnpm e2e && pnpm load:smoke`

---

## 4. Deliverables

| File | Description |
| --- | --- |
| Demo recording | Rehearsal recording + live session notes |
| `docs/retro/phase-1.md` | Plan-vs-actual, scoreboard, keep/change, spec-quality review |
| `docs/plan/phase-3/backlog.md` | Prioritized P0–P3 backlog with sizes and motivations (superseded `phase-2-backlog.md`) |
| `v0.1.0-harness` git tag | Phase-1 release anchor |
| Updated root README | Status: Phase 1 complete |

---

## 5. Acceptance Criteria (the Day-30 bar, from the plan README)

- [ ] `pnpm e2e` passes on a clean Compose stack in < 3 minutes — demonstrated live
- [ ] Full failure matrix (Day 26) demonstrable on demand
- [ ] Concurrency suite (C1–C7) and fault suite (F1–F5) green; load smoke 3/3
- [ ] Every PASSED verification report has ≥1 evidence row (invariant holds across the entire demo DB)
- [ ] Provenance page reconstructs any demo task completely (7 sections + event timeline)
- [ ] All specs at v0.2; dev guide verified on clean checkout; runbook commands all executed
- [ ] Retro doc published with real numbers; Phase-2 backlog prioritized with P0/P1 ticketed
- [ ] `v0.1.0-harness` tagged and pushed

---

## 6. Notes & Pitfalls

- **Demo failures are data, not disasters.** If something breaks live, show the observability tooling catching it — Q8, the event log, the reconciler. A harness that explains its own failure mid-demo is a better demo than a flawless one.
- **Don't let the retro become a celebration-only document.** The scoreboard section must include the slips and the hardening-day bugs. A retro without the uncomfortable numbers is marketing.
- **The backlog's P0s are non-negotiable ordering.** Auth and weight calibration gate everything below them — auto-approve without calibrated weights is exactly the confidence-without-evidence failure this system exists to prevent.
- **Resist "just one more feature" before tagging.** The tag's value is that it's a stable line. Anything merged after Day 30 is Phase 2 by definition.
- **This is the end of the 30-day plan.** Phase 2 gets its own plan, written with Phase-1 evidence in hand — the same way this plan was written with the v0.1 specs in hand.

---

*Prev: [Day 29 — Documentation: Specs v0.2, Dev Guide & Runbook](day-29.md) | End of Phase 1 — next: [Phase 2 Plan](../phase-2/README.md)*
