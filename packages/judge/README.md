# @harness/judge — LLM-as-Judge & Inter-Judge Agreement

Scores a review report against a versioned rubric (severity / routing / evidence),
and measures the judge's own quality via inter-judge agreement.

**Status:** complete (as-built) ·
**Boundary rule:** imports only `@harness/domain` (value types + the `LLMProvider` /
`JudgeRunStore` / `JudgeAgreementStore` seams).

---

## Purpose

1. **Judge the report, not the code** — `Judge.judgeReport` grades a `ReviewReport`'s
   verdict + findings against the rubric; the PR's code and author are out of scope.
2. **Version the rubric** — `RUBRIC_PROMPT_VERSION` (`judge-rubric-v1`) stamps every
   score, so comparisons are only meaningful within one prompt version.
3. **Audit every run** — each score records a `judge_runs` row (report hash + model +
   temperature + prompt version + reasoning) through the `JudgeRunStore` seam.
4. **Make quality measurable** — `computeAgreement` + `AgreementReport` turn matched
   run pairs into per-dimension agreement + Cohen's κ, persisted as `judge_agreements`.
5. **Stay shadow-only** — a score is logged, never applied to a decision; nothing
   consumes it yet.

## Rubric dimensions

| Dimension | Weight | Meaning                                                |
| --------- | ------ | ------------------------------------------------------ |
| severity  | 0.4    | how well the reviewer attributed severity.             |
| routing   | 0.4    | how well the reviewer routed (review vs auto-approve). |
| evidence  | 0.2    | whether findings are evidenced, not asserted.          |

`overall` folds the three; every dimension is numeric `[0,1]`. The prompt shows only
the report's findings + verdict — never the diff — so the judge can't leak judgment
onto the code.

## Data shapes

| Type             | What it is                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `JudgeScores`    | `severityAgreement` / `routingAgreement` / `evidenceSufficiency` / `overall`, each `[0,1]`.       |
| `JudgeRun`       | one audited run (id, reportId, promptVersion, model, temperature, reportHash, scores, reasoning). |
| `JudgeAgreement` | per-dimension agreement + κ over N matched pairs.                                                 |

## Modules

| Module                | What it provides                                                                    |
| --------------------- | ----------------------------------------------------------------------------------- |
| `rubric.ts`           | `RUBRIC_PROMPT_VERSION`, `RUBRIC_WEIGHTS`, `buildRubricPrompt`, `parseJudgeOutput`. |
| `judge.ts`            | `Judge` — rubric prompt → `LLMProvider.complete` → parse → `JudgeRunStore.record`.  |
| `report-hash.ts`      | `canonicalReportHash` — content hash a run is stamped with (reproducibility).       |
| `agreement.ts`        | `computeAgreement` — the pure agreement/κ math over score pairs.                    |
| `agreement-report.ts` | `AgreementReport` — persists one `judge_agreements` row per computation.            |

## Test strategy

- `parseJudgeOutput` is tested against fixture LLM replies (valid + malformed JSON,
  wrong keys), no live model.
- `computeAgreement` is asserted against hand-computed agreement/κ values.
- `AgreementReport` is driven with a scripted store; it throws on a mismatched
  report hash (agreement is meaningless across different content).

## Directory structure

```
src/
├── index.ts
├── rubric.ts
├── judge.ts
├── report-hash.ts
├── agreement.ts
└── agreement-report.ts
```

## Public API surface

```typescript
// RUBRIC_PROMPT_VERSION, RUBRIC_WEIGHTS, buildRubricPrompt, parseJudgeOutput,
// Judge, JudgeOptions, canonicalReportHash, computeAgreement, AgreementReport
```

## Dependency rule

```
packages/judge → @harness/domain only
```

`judge_runs` / `judge_agreements` are the audit tables (`@harness/db`); the judge
records through the domain `JudgeRunStore` / `JudgeAgreementStore` seams.

## Wiring

`TOKENS.Judge` resolves to `Judge(LLMProvider, DrizzleJudgeRunStore(Db), model)`.
`TOKENS.JudgeShadow` (`apps/api`) subscribes `review.report_created` and judges the
freshly stored report in shadow — log-only, never mutating review state.
