# Day 28 — LLM-as-Judge: Rubric-Scored Behind `LLMProvider`, Audited

| | |
|---|---|
| **Week** | 6 — Benchmark + judge |
| **Spec refs** | Spec 11 §5.1 (LLM-as-judge: rubric-scored, `LLMProvider`-mediated, audit trail) |
| **Estimated effort** | 8h |
| **Prerequisites** | Day 27 (benchmark runtime — MBH container) |

---

## 1. Objectives

By end of day you will have:

1. A new package `packages/judge` (`@harness/judge`) with an **LLM-as-judge** scorer that evaluates a `BenchRun` against a **rubric** (not "pass/fail") — Spec 11 §5.1.
2. The judge **always** calls the model through `LLMProvider` — never a raw vendor SDK — so it is swappable, meterable, and mockable.
3. A **structured rubric output** (scores per criterion + rationale), persisted, not a free-text verdict we later can't audit.
4. An **audit trail**: judge runs, model/version, prompt (or hash), rubric version, and output all recorded for later inter-judge agreement (Day 29).

The judge measures *quality* on the frozen corpus; it does not replace correctness (`goldTests`) and it does not decide human gates.

---

## 2. Design Decisions

### 2.1 `judge/` package boundary

`@harness/judge` imports `@harness/domain`, `@harness/event-bus`, `@harness/db`, `@harness/di` — plus the **`LLMProvider` adapter** (from `@harness/llm` or wherever the adapter lives) for all model calls. It does not import `@harness/orchestrator` or `@harness/agent-runtime`.

### 2.2 Rubric model

```typescript
// packages/judge/src/rubric.ts
export interface RubricCriterion {
  id: string;                    // e.g. 'correctness', 'minimality', 'test_coverage', 'evidence'
  weight: number;                // sum of weights = 1.0
  definition: string;            // precise prompt guidance
  maxScore: number;              // e.g. 5
}

export interface Rubric {
  id: string;
  version: string;               // rubric changes are versioned, not mutated
  criteria: RubricCriterion[];
}
```

The rubric is **versioned** exactly like the corpus (Day 26): a calibration change re-versions the rubric; it never mutates in place, so a score is reproducible.

### 2.3 Judge call through `LLMProvider`

```typescript
// packages/judge/src/judge.ts
export interface JudgeInput {
  task: BenchTask;               // problem statement + gold tests (NOT gold patch)
  run: BenchRun;                 // produced patch + test output
  rubricVersion: string;
}

export interface JudgeVerdict {
  runId: string;
  rubricVersion: string;
  scores: { criterionId: string; score: number; rationale: string }[];
  total: number;                 // weighted sum
  model: string;                 // resolved from LLMProvider metadata
  promptHash: string;            // SHA-256 of the assembled prompt
  judgedAt: Date;
}
```

The judge receives the task *statement* and the run's *patch + test output* — **never the `goldPatch`**. Revealing gold to the judge would leak the answer into the scorer and corrupt the measurement.

### 2.4 Audit trail schema

```sql
-- judge_verdicts: run_id, rubric_version, model, prompt_hash, scores (jsonb), total, judged_at
-- judge_audit:    verdict_id, key, before, after   (structural notes, retractions)
```

Every verdict is append-only. A rating is never edited; a correction is a new verdict + an audit row.

### 2.5 Judge ≠ gate, judge ≠ correctness

- `passed` (gold tests, Day 27) is the mechanical correctness signal — the judge never overrides it.
- The judge's `total` is a *quality* signal feeding calibration/evaluation. It never touches `APPROVE`/`REJECT` or `AUTO_APPROVABLE`.

---

## 3. Tasks

### 3.1 Scaffold `packages/judge` (30 min)

- [ ] `package.json`, `tsconfig.json`, barrel; boundary config.

### 3.2 `Rubric` model + `rubric.ts` (60 min)

- [ ] `Rubric`, `RubricCriterion`, versioning (§2.2); seed `rubric_v1` with 4–5 criteria.

### 3.3 Judge core (`judge.ts`) (120 min)

- [ ] `judge(input)` — assemble prompt (rubric + task statement + patch + test output), call `LLMProvider`, parse `JudgeVerdict` (§2.3).
- [ ] Strip `goldPatch` from input before assembly; parse/validate structured output.

### 3.4 Auditor + schema (90 min)

- [ ] `judge_verdicts` + `judge_audit` tables; migration.
- [ ] Persist verdicts + audit records, append-only (§2.4).

### 3.5 Tests (150 min)

- [ ] MockLLM returns structured JSON → parsed, weighted total correct.
- [ ] `goldPatch` is never present in the assembled prompt (assert against the MockLLM's captured input).
- [ ] Malformed/output-as-free-text → error + audit (never silently persists a garbage verdict).
- [ ] Verdicts are append-only; rubric re-version preserves old verdicts.

---

## 4. Deliverables

| File | Description |
|------|-------------|
| `packages/judge/package.json` + `tsconfig.json` + barrel | New package |
| `packages/judge/src/rubric.ts` | `Rubric`, criteria, versioning |
| `packages/judge/src/judge.ts` | `judge()`, `JudgeVerdict` via `LLMProvider` |
| `packages/db/src/schema/judge.ts` + migration | Verdict + audit tables |
| `packages/judge/src/__tests__/judge.test.ts` | Parsing/prompt-hygiene/append-only tests |

---

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/judge test` — all tests pass.
- [ ] Every judge model call goes through `LLMProvider` (no raw SDK in `@harness/judge`).
- [ ] `JudgeVerdict` is structured (per-criterion score + rationale), weighted total correct.
- [ ] The assembled judge prompt never contains `goldPatch` (asserted in a test).
- [ ] Judge verdicts + audit records are persisted append-only; rubric is versioned.
- [ ] Judge never overrides `passed`; judge never touches APPROVE/REJECT/AUTO_APPROVABLE.
- [ ] `pnpm lint` clean; boundary intact.

---

## 6. Notes & Pitfalls

- **The judge is a scorer, not an authority.** It measures quality on a frozen benchmark. It has no say over the human gate. If a `JudgeVerdict` flows anywhere near `review.decision_submitted`, that's a boundary violation — stop and fix it.
- **Never leak `goldPatch` into the judge prompt.** The gold patch is the answer key. A judge that sees it scores leaked knowledge, not the agent's work. Assert prompt hygiene in a test, not a code review.
- **`LLMProvider` is the only model seam.** The judge must be switchable (vendor, model, mock) and meterable. A hard-wired SDK call is the same mistake the agent runtime already eliminated in Phase 1/2.
- **Free-text verdicts are unauditable.** "This looks good" can't drive inter-judge agreement or calibration. Force structured per-criterion scores + rationale, and fail (with an audit record) on malformed output.
- **Append-only is the audit contract.** Edited verdicts are indistinguishable from ret-conning. Corrections are new verdicts + audit rows. In-place mutation is prohibited.
- **Tomorrow (Day 29):** judge calibration + inter-judge agreement + audit trail.

---

*Prev: [Day 27 — Benchmark Runtime: Minimal Benchmark Harness Container (bash + editor)](day-27.md) | Next: [Day 29 — Judge Calibration + Inter-Judge Agreement + Audit Trail](day-29.md)*
