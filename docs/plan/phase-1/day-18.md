# Day 18 — Attention Engine scoring (Risk/Impact/Novelty/Complexity/Confidence)

| | |
|---|---|
| **Week** | W3 — Trust pipeline |
| **Spec refs** | Spec 6 §1–2 (scoring axes + combined score), Spec 1 §1 (attention as resource) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 17 (evidence + diff + report all persisted) |

---

## 1. Objectives

- Build `@harness/attention-engine` scoring that turns review inputs into a comparable attention score.
- Implement five axes — **Risk, Impact, Novelty, Complexity, Confidence** — each normalized to a bounded scale, then combined into one `AttentionAssessment`.
- Produce the `review.priorityLabel` (e.g. `REVIEW_REQUIRED` / `REVIEW_RECOMMENDED`) and a suggested review depth from the score.
- Emit `attention.assessment_created` and keep scoring pure/deterministic (no hidden state, no learned weights — calibration is Phase 2+).

## 2. Design Decisions

- The score is a **budgeting signal**, not a verdict: it routes human attention, it never replaces the human decision.

```ts
export interface AttentionScore {
  readonly risk: number;       // 0..1 — severity of findings + failed evidence
  readonly impact: number;     // 0..1 — blast radius (file count, critical paths)
  readonly novelty: number;    // 0..1 — how unfamiliar the change looks
  readonly complexity: number; // 0..1 — diff size / functions touched
  readonly confidence: number; // 0..1 — evidence strength (pass vs fail/flaky)
}
export interface AttentionAssessment {
  readonly assessmentId: AssessmentID;
  readonly score: AttentionScore;
  readonly priorityLabel: PriorityLabel;
  readonly suggestedReviewDepth: SuggestReviewDepth;
}
```

- Phase 1 uses **placeholder weights** (uniform or hand-set constants) — fitted/learned weights, semantic novelty, and the `shadow-then-default` comparison are explicitly Phase 2+.

## 3. Tasks

### 3.1 Axis scoring (180 min)
- [ ] `scoring/axes/*` — risk, impact, novelty, complexity, confidence, each normalized
- [ ] `scoring/combine.ts` — weighted combination → bounded score

### 3.2 Assessment type + events (90 min)
- [ ] `assessment.ts` — `AttentionAssessment` + `SuggestReviewDepth`/`PriorityLabel`
- [ ] Emit `attention.assessment_created`

### 3.3 Tests (150 min)
- [ ] Deterministic-score unit tests (same inputs → same score), boundary tests (0..1), weighting tests

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/attention-engine/src/scoring/axes/risk.ts` | Risk + impact (and the four peer axes) |
| `packages/attention-engine/src/scoring/combine.ts` | Combination logic |
| `packages/attention-engine/src/assessment.ts` | Assessment value type |
| `packages/attention-engine/src/attention-engine.ts` | Public scoring entrypoint |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/attention-engine test` passes
- [ ] Every axis normalizes into `[0,1]` and combined score is bounded
- [ ] A PR with CRITICAL findings + failed verification scores higher than a clean `APPROVE` with passing evidence
- [ ] `attention.assessment_created` carries `correlation_id`

## 6. Notes & Pitfalls

- Keep weights as injected constants so Day 19 policy and Phase 2 calibration can swap them without touching axis math.
- Confidence is about **evidence**, not the reviewer's certainty — a passing suite raises it, a flaky/timed-out run lowers it.

---

*Next: [Day 19 — AttentionPolicy rules + routing (REVIEW_REQUIRED vs AUTO_APPROVABLE)](day-19.md)*