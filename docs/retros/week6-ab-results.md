# Phase 2 · Week 6 — A/B dry-run: keyword vs semantic context ranking

_Day-29 deliverable (Spec 11 §5). The payoff the semantic shadow has been
building toward for three weeks: the two context rankers — A = keyword (Phase-1,
the control) and B = semantic (the challenger) — are run head-to-head behind the
Day-9 shadow harness, and the comparison comes out on **outcome signals**, not on
ranking-adjacent proxies. Same rule as every prior retro: honest by design,
numbers-first, blameless — and green before committed._

## What shipped

- **`ranking-variants.ts`** — the two ranks behind one seam. `ContextRanker` is a
  pure `corpus → ordering` function; the _only_ difference between the arms is
  that function. Because `@harness/evaluation` must not import an engine
  (boundary R9) or the embedder (R10), both are **self-contained shadow copies**:
  the keyword arm mirrors `context-engine/rank.ts` (0.7 keyword-overlap / 0.3
  dependency-proximity, same tokenizer), and the semantic arm is a deterministic
  term-frequency-cosine stand-in for the production embedder. The harness
  validates the comparison _plumbing_, not the embedder's absolute quality.
- **`outcome-metrics.ts`** — the §2.3 signals as pure functions of
  (ranked order, recorded trajectory): `context_acceptance_rate` (precision),
  `human_minutes_per_accept` (dwell proxy), `rework_rate` (recall-miss), plus
  `rank_correlation` as a **distribution** over inputs, the §2.4 minimum-evidence
  bar (declared before the run), and the Day-30 recommendation.
- **`ab-report.ts`** — the `eval:ab-report` CLI. Replays the trajectory fixtures
  through both arms, records each arm's ranking + `rank_method` + signals to the
  isolated `ab_*` tables, **asserts zero production effect** (live
  `tasks`/`decisions`/`contexts` counts must not move), and emits the comparison.
  `--run <id>` re-emits the report from stored jsonb for reproducibility.
- **Two multi-file fixtures** (`auth-gateway-token-refresh.json`,
  `search-index-ranking.json`) so the canonical single-file fixture is not the
  only input — a single-file corpus renders `rank_correlation` uncomputable
  (<2 shared top-k items), which would have been a recording gap, not a finding.

## What the numbers say — and what they don't say yet

The default run (N=3, top-k=5) produces this comparison:

```text
outcome signals (per arm):
  A keyword:   context_acceptance_rate=1.0000  human_minutes_per_accept=0.494  rework_rate=0.0000
  B semantic:  context_acceptance_rate=1.0000  human_minutes_per_accept=0.494  rework_rate=0.0000

rank_correlation (semantic vs keyword, top-k=5): [-1.000, -1.000]
  count=2  min=-1.000  max=-1.000  mean=-1.000

evidence:      SUFFICIENT
guardrail:     HELD (tasks/decisions/contexts unchanged)
recommendation: promote semantic ranking to a real A/B
```

The honest read is that **the two ranks genuinely disagree and the harness caught
it**. On both multi-file inputs the orderings are _exact reversals_ (`tau = -1`):
keyword surfaces the dependency-central target even when its content barely
matches the task, while semantic surfaces the content-rich helper. That is the
whole hypothesis, confirmed at the _ranking_ layer.

And it is **not** confirmed at the _outcome_ layer — which is the correct,
and the whole point of, a dry-run. On a replayed trajectory the consumed files
are fixed by the record, so every candidate lands inside the top-k either way:
acceptance is `1.0` and rework is `0.0` for _both_ arms. High-ranking-
disagreement + zero-outcome-difference is not a null to dress up; it is exactly
the signal that the ranking change needs **live outcome data** before any default
switch. The recommendation — _"promote semantic ranking to a real A/B, collect
live outcome data first"_ — is the honest answer, not a soft confirmation of the
favorite.

The one number that matters next is therefore **not in this table yet**:
`rework_rate` and `human_minutes_per_accept` can only differ between arms once a
top-k truncation actually leaves a consumed file out on one arm and not the
other. That only happens under live traffic with real top-k pressure, which is
precisely what the recommendation asks Day 30 to set up.

## The invariants, and what holds them

- **Arm B never reached a served snapshot.** The guardrail is enforced twice: by
  construction (`RankingDryRun` holds a `ReadonlyDb` — no `insert`/`update`/
  `delete` exists on the type — plus an `AbStore` that writes only `ab_*`), and
  by the before/after live-count assertion that throws on any movement. The
  integration test seeds a fresh schema, runs the dry-run, and asserts
  `tasks`/`decisions`/`contexts` stay at `0` while every `ab_runs.report` carries
  `rankMethod: 'semantic'`. Held.
- **Vary one thing.** The two arms share the tokenizer, the corpus, the top-k,
  and `ensureTargetsPresent` (a target may never be dropped); only the rank
  function differs. `ranking-variants.test.ts` asserts the arms reorder the same
  corpus and both are deterministic.
- **`rank_correlation` is a distribution, not a scalar.** Reported as `values`,
  `count`, `min`/`max`/`mean`; the canonical single-file fixture contributes no
  tau (its top-k intersection is one item) and is honestly _skipped_, not padded
  to `0`.
- **No boundary was crossed.** `evaluation` imports `domain` + `db` + `di` only
  (the matrix's `SHARED`) — the semantic ranker is a shadow copy, so neither an
  engine (R9) nor `@harness/embeddings` (R10) is touched. The architecture test
  stays green.

## What is still missing

- **A run where top-k pressure actually bites.** With `top-k=5 ≥ |candidates|` the
  two arms can never differ on outcome; the comparison would degrade to "always
  identical outcomes" forever with these fixtures. The harness supports an
  `--top-k` override, but the real fix is live traffic (Day 30), not a smaller
  top-k on the same two-file fixtures.
- **The embedder itself is not exercised.** The semantic arm is a TF-cosine
  stand-in; the production embedder (day-16/17, pgvector) lives in the engine and
  is deliberately out of reach of this package (R10). Its quality is validated
  by the engine's own tests, not this A/B.

## Decisions / debts carried into Day 30

- **Recommendation: promote to a real A/B, not to the Phase-3 default.** The
  ranks differ but the replayed outcome is a toss-up; switching the default on
  ranking disagreement alone would be exactly the "dress up a null result" the
  spec forbids. Day 30 stands up the live A/B mechanics and the metrics
  checkpoint that will let the next decision cite `rework_rate`.
- **Keep the dry-run as the cheap screen.** `rank_correlation` is the canary —
  it proved the two ranks differ — but it is never the verdict. The verdict needs
  the outcome columns filled under live traffic.

---

_Checkpoint rule applied: `pnpm lint`, `pnpm typecheck`, and `pnpm test` are
green; the `eval:ab-report` run above is reproduced verbatim from the isolated
`ab_*` tables via `--run`, with the guardrail HELD. The served `rank_method`
remains `phase1-keyword-dependency`; arm B's `semantic` ranking exists only in
`ab_runs.report`._
