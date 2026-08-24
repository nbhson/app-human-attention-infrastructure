# @harness/benchmark — Review-Quality Corpus Runtime

A versioned store of gold-labelled review examples — the ground truth for
review-quality measurement — plus the corpus loader and judge-vs-gold evaluation.

**Status:** v1.0-candidate (as-built) — pending Day 40 exit review ·
**Boundary rule:** read-only evaluator — imports only `@harness/domain`, `@harness/db`,
`@harness/judge`; never `attention-engine`, `context-engine`, or `review`.

---

## Purpose

1. **Define the example** — `ReviewExample`: a redacted PR diff + requirement + the
   AI's review report (judged artifact) + the human's **gold** labels.
2. **Version + gold-label** — labels are human-derived (never judge output), keyed
   by `scale_version` + `label_set` so a rubric change retags instead of mutating.
3. **Load the corpus** — `loadReviewExamples(db, scaleVersion)` reads `review_examples`
   read-only via `ReadonlyDb`.
4. **Evaluate the judge** — `evaluateJudge` measures how close the judge's scores
   land to the gold (per-dimension `1 − mean|judge − gold|` + usefulness agreement).
5. **Seed deterministically** — `loadSeedExamples` provides a versioned, redacted
   seed corpus (no secrets, no org code).

## What it is *not*

Review examples, **not** coding tasks. There is no SUT patch, no SWE-bench rerun,
no code-generation task — the corpus exists to answer "does the judge/report agree
with a careful human?", the review-quality question.

## Evaluation math

```
severity agreement  = 1 − mean |judge.severity  − gold_severity|
routing  agreement  = 1 − mean |judge.routing   − gold_routing|
usefulness agreement = judge.overall ≥ 0.5 ⇔ gold_useful      (binary)
```

The judge *predicts*; the human *decides*. `USEFULNESS_THRESHOLD` is `0.5`.

## Modules

| Module | What it provides |
| --- | --- |
| `review-example.ts` | `ReviewExample`, `ArtifactFinding`, `JudgedArtifact`, `SCALE_VERSION` (`v1`), `LABEL_SET`. |
| `corpus.ts` | `loadReviewExamples` — version-filtered, read-only `review_examples` load. |
| `eval-judge.ts` | `evaluateJudge` + `reportFromExample` (report reconstruction over a `JudgeScorer` seam). |
| `seed/seed-data.ts` | `loadSeedExamples` — deterministic seed corpus. |

## Test strategy

- The row mapper + version filter are unit-tested without a DB (pure).
- `evaluateJudge` is asserted against a scripted `JudgeScorer` — no live LLM.
- Seed examples are redacted fixtures: identifiers stripped, no real token or org code.

## Directory structure

```
src/
├── index.ts
├── review-example.ts
├── corpus.ts
├── eval-judge.ts
└── seed/seed-data.ts
```

## Public API surface

```typescript
// ReviewExample, ArtifactFinding, JudgedArtifact, SCALE_VERSION, LABEL_SET,
// loadReviewExamples, evaluateJudge, reportFromExample, loadSeedExamples
```

## Dependency rule

```
packages/benchmark → @harness/domain, @harness/db, @harness/judge
                 → never an engine (attention/context/review)
```

`review_examples` is the store table (`@harness/db`); the benchmark only reads it,
filtered by `scale_version`.