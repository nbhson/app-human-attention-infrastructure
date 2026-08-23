# Day 24 — Review-quality Corpus: Versioned Gold Labels

| | |
|---|---|
| **Week** | 5 — Review-quality calibration |
| **Spec refs** | Spec 11 §5.1 (judge benchmark); Phase-3 README §4 (benchmark package) |
| **Estimated effort** | 7h |
| **Prerequisites** | Days 21–23 (judge + agreement + weight-fitting) |

---

## 1. Objectives

By end of day you will have:

1. A new `packages/benchmark` (`@harness/benchmark`): a **review-quality corpus runtime** — a versioned store of *gold-labeled review examples* (a PR diff + requirement + the review report + human gold labels for severity/routing/usefulness).
2. Gold labels are **human-derived** (reviewer-rater annotations, `was_useful`, decisions), versioned so a changed rubric/scale doesn't silently invalidate older labels.
3. A corpus loader that feeds both the judge (agreement vs gold) and the benchmark regression (Day 39) — no code-generation/SWE-bench-style writing tasks.
4. A small seed corpus (a handful of verified examples) with an ingestion/audit path for more.

This is the *ground truth* for review-quality measurement; Day 25 checks out judge + calibration against it.

---

## 2. Design Decisions

### 2.1 The corpus is review examples, not coding tasks

Each item: `{ prDiff, requirement, report, gold: { severity, routing, useful } }`. The gold labels are what a careful human says the *review report* should have concluded — no "generate working code", no SUT patch, no SWE-bench rerun. The reorientation means the benchmark measures **review quality**, never code synthesis.

### 2.2 Versioned gold labels

A `scale_version` + `label_set` columns; changing the rubric scale bumps the version and migrates/retags labels rather than mutating them in place. Auditable and reproducible.

### 2.3 Boundary

`@harness/benchmark` imports only `@harness/domain`, `@harness/db`, `@harness/di`, and the `@harness/judge` seam (to run the judge) — it never imports `attention-engine`, `context-engine`, or `review`. It is a *read-only evaluator*.

### 2.4 Seed corpus is curated, not scraped

Start with hand-verified examples from real Phase-2 reviews (anonymized/redacted); every item is sourced and reviewable before inclusion.

---

## 3. Tasks

### 3.1 Scaffold + schema (60 min)

- [ ] `packages/benchmark/package.json` + `tsconfig` + boundary entry.
- [ ] `packages/db/src/schema/benchmark.ts` — `review_examples` (versioned gold labels) + migration.

### 3.2 Corpus loader (90 min)

- [ ] `packages/benchmark/src/corpus.ts` — load/filter by `scale_version`, return typed examples.

### 3.3 Judge-vs-gold evaluation (90 min)

- [ ] `packages/benchmark/src/eval-judge.ts` — run judge over corpus, compute agreement vs gold, record results.

### 3.4 Seed corpus (60 min)

- [ ] Ingest 5–10 redacted, human-verified examples; document the label rubric.

### 3.5 Tests (60 min)

- [ ] Corpus loads typed items; version filtering; judge-vs-gold agreement math; boundary grep.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/benchmark/package.json` + `src/index.ts` | New `@harness/benchmark` package |
| `packages/db/src/schema/benchmark.ts` | `review_examples` (versioned labels) |
| `packages/benchmark/src/corpus.ts` | Corpus loader |
| `packages/benchmark/src/eval-judge.ts` | Judge-vs-gold evaluation |
| `packages/benchmark/src/seed/*.json` | Seed examples (redacted) |

---

## 5. Acceptance Criteria

- [ ] `review_examples` stores gold-labeled review examples with versioned labels.
- [ ] Corpus loads typed items filtered by `scale_version`.
- [ ] Judge-vs-gold agreement computed over the seed corpus.
- [ ] No code-generation/SWE-bench-style tasks in the corpus.
- [ ] Boundary: `@harness/benchmark` imports only domain/db/di + judge seam.

---

## 6. Notes & Pitfalls

- **Gold labels are human, never judge-output.** A corpus of judge's own scores teaches nothing — every gold label must trace to a human rater/decision.
- **Version the labels with the rubric.** Changing "severity 1–5" to "1–3" invalidates old gold unless the version is recorded; bump-and-retag, don't edit silently.
- **Redact the seed.** Real review examples contain repo paths/diffs — strip identifiers before they enter the repo; no secrets, no org-proprietary code.
- **Day 25** checkpoint: judge + calibration run end-to-end.

---

*Next: [Day 25 — Week 5 Checkpoint: Judge + Calibration Run End-to-end](day-25.md)*