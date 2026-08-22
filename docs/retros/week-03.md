# Phase 2 · Week 3 Retro — Calibration & Auto-Approve

*Day-15 checkpoint (Phase 2). Third pass, over the calibration + gated auto-approve
stack built across Phase-2 days 11–15. Same rule as prior retros: honest by
design, numbers-first, blameless — and every acceptance criterion is green before
this note is committed. This week's checkpoint is a hard one: the fit was measured
against the placeholder on a held-out set, and the result is red — this note says
so plainly, and documents why that is the correct outcome to ship.*

## What shipped this week

- **Day 11 — calibration dataset.** `eval:make-dataset` extracts a frozen,
  hash-sealed snapshot of the assessment → feedback → outcome join
  (`calibration_datasets` / `calibration_rows`, `content_hash` over the ordered
  row set) with a coverage report (row count, null share, class balance).
- **Day 12 — weight fitting.** `eval:fit` trains a five-factor logistic-regression
  weight vector on an 80/20 split and prints a before/after `FitReport` —
  placeholder vs fitted `log_loss` + `ranking_accuracy`, an `improvement` boolean,
  and a governance note when the fit fails to beat the placeholder. Append-only:
  every run INSERTs a `calibration_weights` version row.
- **Day 13 — adaptive thresholds + inflation monitor.** Alert-fatigue budget,
  adaptive thresholds, and an `inflation` gauge (CRITICAL+HIGH share) that mirrors
  the Spec-6 §4.1 ceiling.
- **Day 14 — auto-approve flag + kill-switch + sampling audit.** An
  ADMIN-gated flag and kill-switch (single DB row), a three-part gate
  (calibration *green* ∧ flag *on* ∧ item *under the bar*), a machine decision
  path (`AUTO_APPROVED`, `actor_id IS NULL`), and a 10% silent-human sampling
  audit whose `escalation_leakage` is published on a sampled reject.

## What the checkpoint numbers actually say

`eval:make-dataset --label=outcome` over the seeded decision window, then
`eval:fit` on that dataset, produced — live in the dev DB — this before/after:

| | `log_loss` | `ranking_accuracy` | weight vector |
|---|---|---|---|
| **Placeholder (Phase-1)** | **0.262** | 1.0 | `risk .35 · impact .25 · novelty .15 · complexity .10 · confidence .15` |
| **Fitted (logistic-regression-v0)** | 0.316 | 1.0 | uniform `0.2` across all five factors |

Dataset was **5 rows** (4 APPROVED / 1 REJECTED, 40% null feedback), train split
4, **held-out split 1**. `improvement: false`, and the fit's own governance note
is on the record: *"fitted weights did not beat the Phase-1 placeholder on
held-out validation; the placeholder stays active."*

**The one-line verdict:** *No — calibration did not improve routing on the
available corpus: the fitted weights (log-loss **0.316**) did not beat the
Phase-1 placeholder (log-loss **0.262**) on the held-out set, so the placeholder
stays active and auto-approve stays red.*

That verdict needs the honest caveat it is owed. This is not evidence that
calibration *cannot* help — it is evidence that **the corpus is not yet large
enough to say either way**. With a one-row held-out set, `log_loss` differences
are noise and `ranking_accuracy` can only be 0 or 1. The fitter did exactly the
right thing: it measured a worse loss and *declined to promote itself*. The
checkpoint rule is satisfied (the number exists and is real), but the scientific
claim — "fitting beats hand-tuned placeholders" — is still **unproven**, not
refuted. Week 4 must not treat this red as license to skip calibration; it must
treat it as the argument for accumulating a corpus before the A/B dry-run (Day 29).

## What is still missing (and Week 4 must not paper over it)

- **A benchmark corpus and gold labels.** Same wall as Week 2, now with a sharper
  edge: the fitter *works*, but 5 rows (1 held-out) is not a population, and
  `outcome` (human approve/reject) is a stand-in for ground truth, not the truth
  itself. Until `was_useful`/outcome rows accumulate in the hundreds, no fit can
  be validated as an *improvement* — only as a change with a measured direction.
- **The A/B seam is unblocked, but unused.** Day-09's shadow harness can compare
  keyword vs semantic ranking the moment the Week-4 index lands. The only thing
  that should be built to *enable* that comparison is the semantic ranker itself —
  the metric basis (mean target relevance) is already the right comparison frame;
  do not wrap it in a new measurement layer.
- **The sampling audit is a canary, not a net.** 10% of approvals get a silent
  human control, which means ~90% of auto-approvals are unaudited by design. The
  residual risk is carried until the corpus is large enough to *prove* the
  auto-approvable bar, not just set it.

## What is fragile

- **`--label` only accepts the equals form.** The Day-15 plan wrote
  `--label outcome`; `parseLabel` reads only `--label=` and silently falls back to
  `feedback` on the space form. The demo already flags this, but it is a trap a
  future operator will hit twice: they get a dataset, the `label_source` column
  says `feedback`, and the fit quietly targets the wrong label. Either the CLI
  should accept both forms or the plan's invocation should be corrected — flagging,
  not fixing, until a day owns it.
- **One-row held-out sets make `ranking_accuracy` binary.** With `validationShare
  = 0.2` and N=5, the validation split is a single row and accuracy is `0` or `1`
  regardless of fit quality. `improvement` is then driven almost entirely by
  `log_loss` on one point — volatile by construction, not a solver defect.
- **The seed corpus and organic data are indistinguishable in the fit table.**
  `calibration_datasets` rows are versioned and hash-sealed, but nothing marks a
  dataset as "seeded fixture" vs "organic telemetry" beyond reading the row count.
  A red fit over 5 seeded rows is not evidence against calibration; a later reader
  skimming `improvement: false` without the N could read it as one. Keep the
  fixture label carried in the demo/retro, since the schema does not carry it.

## Boundary check

- **No engine reached for another engine.** The executor's cross-engine
  dependencies (latest calibration fit, inflation gauge, task state machine) are
  the injected `AutoApproveLoader` and `AutoApproveTaskTransition` seams, so
  `attention-engine` still imports only `domain`, `event-bus`, `db`, `di`,
  `observability` — never orchestrator/review/evaluation. The architecture test
  (R4/R7/R8) is green and the `wiring-map.md` now records the four Day-14 tokens.

## Decisions / debts carried into Week 4

- **Keep the placeholder; do not tune by hand to make the fit look better.** The
  honest result of a fit that loses is to *keep* the placeholder, exactly as the
  governance note says. Re-running the fit with a friendly `--seed` until it wins
  would be dressing a regression as progress — the day-15 §6 cardinal sin.
- **Accumulate corpus, don't force it.** Week 4 is semantic infrastructure
  (pgvector, `Embedder`, retriever). Its natural side effect is more decidable
  rows; treat "enough rows to re-fit on" as an exit criterion for Week 5's A/B
  dry-run, not a separate build day.

---

*Checkpoint rule applied: `pnpm eval:make-dataset --label=outcome` printed a real
5-row dataset (hash `e88c5bde…`), `pnpm eval:fit` printed a real `FitReport` with
placeholder 0.262 / fitted 0.316 and `improvement: false`, the sampled-control +
kill-switch paths are covered by the Day-14 test suite, and
`auto_approve_enabled = false` / `auto_approve_kill_switch.enabled = true` is the
restored end-of-day state. lint, typecheck, and the full test suite are green
before this note is committed. R4/R7/R8 and the no-engine-imports-engine rule are
asserted by `packages/di/src/__tests__/architecture.test.ts`.*