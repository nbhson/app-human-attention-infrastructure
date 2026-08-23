# Day 21 — LLM-as-judge on Review Reports: Severity/Routing Rubric

| | |
|---|---|
| **Week** | 5 — Review-quality calibration |
| **Spec refs** | Spec 11 §5.1 (LLM-as-judge, rubric-scored, audited); Phase-3 README §3 (Judge anchor) |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 20 (W4 checkpoint); Phase-2 review reports + decision/`was_useful` log exist |

---

## 1. Objectives

By end of day you will have:

1. A new `packages/judge` (`@harness/judge`): an **LLM-as-judge** that scores a *review report* against a **rubric** — severity agreement and routing agreement — behind `LLMProvider`.
2. A rubric with severity/routing dimensions (e.g. severity under/over-call, routing target agreement, evidence sufficiency), each scored deterministically into the same schema.
3. Rubric scores stored **audited** (judge run, prompt version, model, raw reasoning), never trusted unlogged.
4. A fixture report scored end-to-end with the judge in "shadow" (log only, feeds nothing yet).

This day installs the *measure* of review quality; Day 22 adds inter-judge agreement, Day 23 feeds it to weight fitting.

---

## 2. Design Decisions

### 2.1 The judge scores reports, not code

The judged artifact is the **review report** (findings + severity + recommended routing + evidence). The judge answers "was this report's severity/routing right?" — it never scores AI-written code, never proposes fixes. This is review-quality measurement.

### 2.2 Rubric → structured scores

```typescript
// packages/judge/src/rubric.ts
export interface JudgeScores {
  severityAgreement: number;   // [0,1] did the report rate finding severity correctly?
  routingAgreement:  number;   // [0,1] did the report route to the right human attention?
  evidenceSufficiency: number; // [0,1] are claims evidence-backed?
  overall:           number;   // weighted rubric total
}
```

The judge returns scores + `reasoning` (short) + a `promptVersion` stamp. Scores are numeric so they can feed calibration (Day 23) and agreement stats (Day 22) — not prose-only.

### 2.3 Behind `LLMProvider`, audited

`Judge` calls the configured `LLMProvider` with a versioned rubric prompt; every run writes a `judge_runs` row (report id, prompt version, model, scores, reasoning). Judge output is *never* used to mutate a review — it's a measurement, logged first, consumed later.

### 2.4 Boundary

`@harness/judge` imports only `@harness/domain`, `@harness/di`, and the `LLMProvider` seam — never `review`, `attention-engine`, or another engine.

---

## 3. Tasks

### 3.1 Scaffold `@harness/judge` (30 min)

- [ ] `package.json` (`@harness/judge`), `tsconfig`, boundary entry.

### 3.2 Rubric + schema (60 min)

- [ ] `JudgeScores` + rubric prompt (versioned); `packages/db/src/schema/judge.ts` — `judge_runs` + migration.

### 3.3 `Judge` service (90 min)

- [ ] `judgeReport(report)` → `LLMProvider` call → parse to `JudgeScores` → persist `judge_runs`.

### 3.4 Shadow wiring (60 min)

- [ ] After `review.completed`, trigger a judge run in shadow (log-only); no consumer of the score yet.

### 3.5 Tests (75 min)

- [ ] Fixture report → deterministic scores (stubbed LLM); prompt-version stamped; `judge_runs` row written; boundary grep.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/judge/package.json` + `src/index.ts` | New `@harness/judge` package |
| `packages/judge/src/rubric.ts` | `JudgeScores` + versioned rubric prompt |
| `packages/judge/src/judge.ts` | `Judge.judgeReport` |
| `packages/db/src/schema/judge.ts` | `judge_runs` schema |
| `packages/judge/src/__tests__/judge.test.ts` | Judge tests |

---

## 5. Acceptance Criteria

- [ ] `Judge.judgeReport` returns numeric `JudgeScores` (severity/routing/evidence/overall) from a stubbed LLM.
- [ ] Every run writes `judge_runs` with prompt version + model + scores + reasoning.
- [ ] A fixture report scores correctly against the rubric (known-good fixture).
- [ ] Judge runs in shadow — no report/decision mutated by its output.
- [ ] Boundary: `@harness/judge` imports only domain/di + `LLMProvider` seam.

---

## 6. Notes & Pitfalls

- **The judged artifact is the report, not the PR's code.** Keep the prompt scoped to "how good is this review" — never grade the PR or the author, which would leak non-review judgment.
- **Numeric scores are the contract.** Prose-only "this is a good review" can't feed agreement stats or weight fitting; the rubric must land on numbers.
- **Version the rubric prompt.** Retroactive score changes are only interpretable if you can map scores → prompt version.
- **Day 22:** inter-judge agreement + audit trail.

---

*Next: [Day 22 — Inter-judge Agreement + Audit Trail](day-22.md)*