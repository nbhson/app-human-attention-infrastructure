# Phase 3 · Exit Review — Learning Loop Closes; Hybrid Held; v0.3.0-harness Tagged

*Day-40 checkpoint (Phase 3 exit). The review decides whether the phase is done —
it does not rubber-stamp (day-40 §2.2). Stand in front of the nine `README §7`
exit criteria with a named artifact each, restate the phase's moral core, and say
plainly what shipped and what is carried forward. Verdict:*

> ## EXIT-WITH-CARRYFORWARD
> **8 of 9 criteria met.** The one not met — *hybrid context ranking as the
> default* (criterion 7) — is carried to the Phase-4 backlog because the Day-29
> A/B returned **HOLD** (`rank_correlation [1.000, 1.000]`, evidence
> INSUFFICIENT, guardrail HELD). Hybrid is built, reachable, and shadow-measured;
> `keyword` remains the default by the phase's own "won, not inherited" rule
> (README §8.4). The tag is still appropriate — every deliverable shipped and the
> safety invariants hold — but the exit is honest about what did not close.

---

## 1. The nine exit criteria, each against a named artifact

| # | Criterion (README §7) | Verdict | Named artifact |
|---|---|---|---|
| 1 | Learning step closes automatically (decisions + judge signals → calibration/routing) | ✅ MET | `pnpm demo:closed-loop` (day-35) — cycle 1 PROMOTE (`deploy=succeeded`, `promoted:true`, `samples:4`) → cycle 2 HOLD (`deploy=held`) → cycle 3 re-entry (`outcome:completed`); human gate untouched |
| 2 | MCP connectivity — GitHub/GitLab/Bitbucket fetch PR/MR, Jira fetch/search/comment/transition, all via `@harness/mcp` + one `mcp.config.json`, tokens env-referenced, no per-host REST | ✅ MET | `pnpm demo:mcp-connectivity` (day-5) + `e2e/load-profile.spec.ts` |
| 3 | AI connection unchanged — api key + provider + base URL + model | ✅ MET | `provider_configs` (`kind='ai'`) + `.env.example` (placeholder key only) |
| 4 | Write-back behind toggle; `writeback_log` records every external write; OFF = nothing external | ✅ MET | `pnpm demo:writeback-toggle` + `docs/retros/phase3-hardening.md` |
| 5 | Verification breadth — clone + sandbox build/test; targeted verification reduces latency; FAILED flags report | ✅ MET | `pnpm demo:verification` + `e2e/load-profile.spec.ts` |
| 6 | Review memory — write-back, consolidation, decay, archive, relevance-scored retrieval; past outcomes surface to Attention/context | ✅ MET | `pnpm demo:memory` (day-20) |
| 7 | Hybrid context ranking (BM25 + embeddings + RRF + re-rank) is the default; RAG Fusion behind `Retriever` | ❌ NOT MET | `docs/retros/phase3-w6-cutover.md` — A/B HOLD; `rank_method` stays `keyword` |
| 8 | LLM-as-judge (rubric-scored, audited) → quality signals into ranking/calibration, with demonstrated inter-judge agreement | ✅ MET | `pnpm judge:agreement-report` + `pnpm benchmark:regression` (day-39) |
| 9 | `pnpm test && pnpm lint && pnpm e2e` green; closed-loop job runs end-to-end autonomously | ✅ MET | this commit — 969 unit / 9 e2e / lint clean; closed-loop demo re-runs green |

> **Note on the count.** day-40.md's prose says "seven `README §7` exit criteria",
> but §7 actually lists **nine**. This review walks all nine; the two the "seven"
> wording misses are criterion 3 (AI connection unchanged) and criterion 8 (judge
> inter-agreement) — both met here.

### 1.1 Criterion 1, read honestly

The loop **closes** and is demonstrable, but the *deploy* step is a measured
**PROMOTE/HOLD gate, not a silent mutation** (`phase3-w7.md`): "a promoted
candidate is never silently applied" — "promoted" is an audit flag, not a write
of weights. The cycle-1 PROMOTE landed on a 4-sample demo window; the subsequent
re-entry came back HOLD. That the automation *stops at the measured gate* is the
whole point — it is why the human APPROVE/REJECT gate stays untouched and
`AUTO_APPROVABLE` is not consulted. Criterion 1 is therefore **met in the "feed
back automatically" sense**, with the *apply* half carried under CF-2 below.

## 2. The moral core, re-verified (day-40 §2.3)

The phase's reviewer-read-only core is re-checked before calling review-only work
"done":

- **Write-back** wrote commentary/status only (`writeback_log`-audited, toggle OFF
  = nothing external). Never a code change.
- **Verification** ran the PR's *own* tests in the sandbox and flagged; it never
  authored a fix.
- **Memory** holds reviews / findings / decisions — no code-generation trajectory
  state.
- **Judge / benchmark** measured review *quality only*; the corpus is
  review-quality gold labels with **no code-generation content** (day-39 §2.4).

No violation. The reorient's central promise — the harness reviews an external PR,
never writes one — holds across all four surfaces.

## 3. The numbers at exit

| Run | Result |
|---|---|
| `pnpm test` (unit) | **969 passed** / 166 files, 0 failed |
| `pnpm lint` | clean |
| `pnpm e2e` | **9 passed** / 2 files (`load-profile` + full-system) |
| `pnpm benchmark:regression` | **PASS 10/10** — every metric within tolerance of the Day-25 baseline |
| `pnpm judge:agreement-report` | inter-judge severity/routing **0.920 / 0.945** (κ 1.000, n=6); judge-vs-gold **0.935 / 0.958 / 1.000** — recomputed *from the audit rows* |

The regression and the recompute both carry the stated honesty boundary
(`phase3-benchmark.md`): the seeded-PRNG judge makes Δ=0.000 *by construction*, so
these prove the **pipeline math** is regression-free — they do not detect
live-judge drift (no key in repo, by design) and `n=6` is a mechanism test, not a
signal.

## 4. Carried forward

### CF-1 · Hybrid ranking is not yet the default → backlog item 1 (unchanged, still open)

Day-29's A/B returned **HOLD** on the shadow baseline (`rank_correlation
[1.000, 1.000]`, "evidence: INSUFFICIENT", "guardrail: HELD"). By `README §8.4`
*"each new default is won, not inherited"*, hybrid stays reachable + shadow-measured
and `keyword` stays the default. The gate is unchanged from `backlog.md` §1: hybrid
must win a **live outcome-data A/B** — arm B lowering review inefficiency without
losing `context_acceptance_rate`, at top-k pressure — *before* `rank_method` flips
off `keyword`.

### CF-2 · Fitted weights are not yet auto-applied → backlog item 6 (unchanged, still open)

The loop re-ran calibration and closed, but the measured result was HOLD — with the
`n=6` seeded corpus and no accumulated live `was_useful` rows, the fit does not yet
beat the Phase-1 placeholder on real outcome data. `StaticWeightsAdapter`
placeholder therefore remains the **measured** default, and the automation stops at
the gate (promoted = audit flag, not a mutation). The gate is unchanged from
`backlog.md` §6: accumulate real `was_useful` + assessment + outcome rows, then
`eval:fit` must print `improvement: true` *and* hold the inflation-monitor ceiling —
only then does `WeightsProvider` flip off the placeholder.

Neither carry raises a new seam; both named the seam and the gate at Phase kickoff.
They are "the honest result", not regressions — and they are exactly the two items
Phase 2 already handed Phase 3 as *un-won defaults*.

## 5. Acceptance criteria

- [x] All nine `README §7` criteria marked met/not-met with a named artifact each.
- [x] Learning loop demonstrably closes; human APPROVE/REJECT gate proven untouched.
- [x] Reviewer-read-only re-verified across write-back / verification / memory / judge.
- [x] `pnpm test && pnpm lint && pnpm e2e` green on the tagged commit (969 / 9 / clean).
- [x] `v0.3.0-harness` tagged; carries (CF-1, CF-2) named and pointed at their backlog items.

---

*End of Phase 3.*