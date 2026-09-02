# Phase 2 → 3 Exit Review — Metrics Checkpoint

_Day-30 deliverable (Phase-2 README §7, Spec 1 §24.3). The Phase-2 numbers,
marked against every exit criterion, with the one honest caveat up front: some
of these gauges have a Phase-1 baseline to compare against, and some do not —
because Phase 1 never recorded one. That absence is itself a finding, and it is
carried into Phase 3 rather than papered over with a synthetic "improvement"._

**Decision: go-with-caveats → tag `v0.2.0-harness`.** Eight of nine exit
criteria are fully met; the ninth is met halfway (weights fitted, improvement
not demonstrated). Details in §3.

---

## 1. The §7 exit criteria, marked

| §7 Exit criterion                                                               | Verdict | Evidence (cited)                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing precision/recall computed & reviewed against a real decision log        | **✓**   | `routing.precision` 0.333, `routing.recall` 0.5, `escalationLeakage` 1.0, `inflationRatio` 0.5, `humanMinutesPerAccept` 2.5 — computed from the real `decisions` × `assessments` × `review_queue` join over N=4 (week-02)         |
| Attention weights fitted from `was_useful`; inflation improved over placeholder | **△**   | Fitted: yes (`eval:make-dataset` → `eval:fit`, Day 12). Improved: **no** — fitted log-loss 0.316 did _not_ beat the Phase-1 placeholder's 0.262 on held-out, so `StaticWeightsAdapter` stays (wiring-map line 38)                 |
| A/B harness replays + head-to-head, no production effect                        | **✓**   | Day-9 `BASELINE` vs `DEP_HEAVY` (`noProductionEffect===true`); Day-29 keyword vs semantic dry-run: `rank_correlation` `[-1.0, -1.0]`, guardrail HELD — `tasks`/`decisions`/`contexts` unchanged                                   |
| Semantic infra shadow-only; `rank_method` default `keyword`                     | **✓**   | `RANK_METHOD` wired to `'phase1-keyword-dependency'` (`apps/context-engine/src/trim.ts:22`); `semanticShadowEnabled` default **OFF** (`types.ts:50`); shadow-negative test asserts the keyword path makes **zero** embedder calls |
| SSO/OIDC + roles; identity on audit                                             | **✓**   | OIDC `sub`-keyed login, revocable JWT sessions, `ADMIN ⊇ REVIEWER ⊇ OPERATOR` role gate; `review_decisions.actor_id` non-null (Week 1) — the Phase-1 `X-Reviewer-Id` header is gone                                               |
| Auto-approve gated: flag + sampling audit + calibration                         | **✓**   | Three-part gate (`calibration-green ∧ flag on ∧ under the bar`) in `AutoApproveExecutor`; flag **OFF at rest**, kill-switch armed, 10% silent-human sample audits leakage (Week 3)                                                |
| Spec 8 + Spec 10 promoted                                                       | **✓**   | `docs/core/8_Human_Review_Interface_v0.1.md` (Day 24), `docs/core/10_Observability_Governance_v0.1.md` (Day 10)                                                                                                                   |
| Sandbox verifiable; large artifacts via `ContentStore`                          | **✓**   | `SandboxedCheck` (container, in-process parity fallback) + `ObjectStoreContentStore` / `InMemoryContentStore` offload behind the `ContentStore` seam; Day-25 sandbox/fallback/integrity counters                                  |
| `pnpm test && pnpm lint && pnpm e2e` green                                      | **✓**   | 695 tests / 132 files; lint; typecheck; build; e2e happy-path + 8 failure scenarios                                                                                                                                               |

**Tally: 8 ✓, 1 △, 0 ✗.** No criterion is un-measured ("not-checked"); every row
carries a number or a code anchor.

---

## 2. Baseline vs Phase 2 — and what has no baseline

The acceptance bar ("measure against the Phase-1 baseline, not against nothing")
is met where a Phase-1 baseline exists, and **not silently invented where it
does not**:

| Metric                               | Phase-1 baseline                 | Phase-2 result                        | Delta is real?                                                               |
| ------------------------------------ | -------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| Attention weight log-loss            | placeholder **0.262** (held-out) | fitted **0.316**                      | **no win** — placeholder kept (honest loss, not a regression dressed as one) |
| Routing precision / recall / leakage | **not recorded**                 | 0.333 / 0.5 / 1.0 (N=4)               | **n/a** — no Phase-1 gauge existed to compare against                        |
| Inflation ratio                      | **not recorded**                 | 0.5 (guardrail-tripping on first run) | **n/a**                                                                      |
| Human minutes per accept             | **not recorded**                 | 2.5                                   | **n/a**                                                                      |
| `rank_method`                        | `keyword`                        | `'phase1-keyword-dependency'`         | unchanged by construction                                                    |

### Finding 1 — the routing metrics have no Phase-1 baseline.

Phase 1 produced the loop (task → change → review → merge) but **no metrics
subsystem**; `eval:metrics`, `MetricsComputer`, and the `evaluation_reports`
store all landed in Phase 2 (Days 6–7). So "routing is now measured" is true, but
"routing improved over Phase 1" is **unanswerable** — there is nothing to compare
against. This is exactly the day-30 pitfall #2 case ("if the baseline was never
recorded, that itself is a finding worth carrying into Phase 3"). It is carried
below (§4, item 6) as "calibration data accumulation" — the only fix is time
(accumulate `was_useful` rows) plus tooling (a Phase-1-style numbers checkpoint
as a recording habit).

### Finding 2 — the weight fit did not beat the placeholder, and that was handled honestly.

Week 3's checkpoint was a **hard** one: `eval:fit` produced fitted weights
(log-loss 0.316) that lost to the Phase-1 placeholder (0.262) on the held-out
set. The governance rule held — `StaticWeightsAdapter` was _not_ auto-promoted,
`eval:fit` printed an `improvement: false` verdict with a governance note, and
the placeholder stayed. The criterion's "improvement over placeholders" half is
therefore **△**, not ✓, and the system was left in its safe default. This is the
correct behaviour — a fit that does not beat the baseline must not ship — but it
means "calibrated weights" is still aspirational, not done.

---

## 3. Go / no-go decision

**go-with-caveats.** The two caveats are data-thinness, not engineering failure:

1. **Attention improvement not demonstrated** — the fit exists, runs, and prints
   a before/after verdict, but did not earn the default (log-loss 0.316 vs
   0.262). Nothing regressed; the placeholder is the correct, measured default.
2. **Routing "improvement" unmeasurable** — the gauges resolve to real values
   over a real decision log, but Phase 1 left no baseline, so Phase 2 can only
   say the loop is _measured_, not _improved_.

Neither caveat blocks the Phase 2 → 3 transition: Phase 3's whole point is to
accumulate the evidence that will _make_ these numbers meaningful (memory,
benchmark corpus, LLM-as-judge, closed-loop calibration). A **no-go** would be
the call if any criterion was ✗ (e.g. auto-approve ON at rest, `rank_method`
flipped, or the guardrail violated) — none is.

---

## 4. Carried into Phase 3 (from this checkpoint)

1. **Re-run the weight fit to a verdict.** Once `was_useful` rows accumulate
   beyond the N=4 window, re-run `eval:fit` and flip `WeightsProvider` _only_ if
   the fitted weights beat 0.262 on held-out and the inflation-monitor stays
   under the ceiling. Seam: `WeightsProvider` (day-12). Gate: `improvement: true`
   before flipping `StaticWeightsAdapter` (backlog item).
2. **Commit to a Phase-1-style numbers checkpoint.** The reason a baseline was
   missing is that Phase 1 had no ticket for "write the numbers down." Phase 3's
   Week-1/Week-3 checkpoints take the same N-window measurement habit the
   Phase-2 weeks already have, so a future exit review has a real baseline.
3. **Watch escalation leakage — it is still 1.0.** Every auto-approvable item
   leaked to `REWORK` on the N=4 window. Phase 3's closed loop is the thing that
   must move it down; it is the single number §4 of the Week-6 retro names.
4. **Coverage still unmeasured.** Test volume (695) and the green gate are
   established, but a line/branch coverage threshold has never been recorded in
   any phase. Backlog item — wire `@vitest/coverage-v8` before Phase 3's first
   numbers checkpoint.

---

_Checkpoint rule applied: `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm test` (695/132 green), and `pnpm e2e` (happy-path + 8 failure scenarios)
all green before this note is committed. The served `rank_method` is
`'phase1-keyword-dependency'`, `semanticShadowEnabled` is **OFF**, and the
auto-approve flag is **OFF** — the system is left in its safe defaults._
