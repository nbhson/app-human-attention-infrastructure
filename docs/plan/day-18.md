# Day 18 — Attention Engine Scoring (Phase 1 Factors)

| | |
|---|---|
| **Week** | 3 — Trust Pipeline |
| **Spec refs** | Spec 6 — Attention Engine §3 (v0.1, updated — corrected formula) |
| **Estimated effort** | 6 h |
| **Prerequisites** | Day 16 (flaky flag), Day 17 (diff line counts), Day 09 (AWAITING_REVIEW entry point) |

---

## 1. Objectives

1. Stand up `packages/attention-engine` with the **corrected scoring formula** (from the spec fix — the `confidence` term was mathematically inverted in v0.1 and was fixed):
   `combined_priority = w_risk·risk + w_impact·impact + w_novelty·novelty + w_complexity·complexity + w_confidence·(1 − confidence_score)`
2. Implement Phase-1 **factor extractors** producing normalized `[0,1]` scores from real data (verification, diffs, trajectory).
3. Apply placeholder weights `0.35/0.25/0.15/0.10/0.15` and priority labels **Critical ≥0.80 / HIGH ≥0.60 / MEDIUM ≥0.30 / LOW <0.30**.
4. Handle **unavailable factors**: neutral 0.5 + weight redistribution, recorded in `factors_unavailable` jsonb (spec fix).
5. Score every task entering AWAITING_REVIEW; persist `attention_assessments` for audit and Day-19 routing.

> **Why this matters:** this engine decides what humans look at first — it *is* the product ("control plane for Human Attention"). A scoring bug here doesn't crash anything; it silently misranks human attention, the worst failure mode. The corrected `w_confidence·(1 − confidence)` term means *low* agent confidence *raises* priority — exactly the intended semantics.

---

## 2. Design Decisions

### 2.1 Types & tables (migration `0018_attention.sql`)

```ts
// packages/attention-engine/src/types.ts
export interface FactorScores {
  risk: number; impact: number; novelty: number; complexity: number; confidenceScore: number;
}
export const PRIORITY_WEIGHTS = { risk: 0.35, impact: 0.25, novelty: 0.15, complexity: 0.10, confidence: 0.15 } as const;

export interface AttentionAssessment {
  id: string; taskId: string; changeId: string;
  factors: FactorScores;
  factorsUnavailable: string[];          // e.g. ['novelty'] — scored 0.5, weight redistributed
  combinedPriority: number;              // [0,1]
  label: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}
```

```sql
CREATE TABLE attention_assessments (
  id                   TEXT PRIMARY KEY,
  task_id              TEXT NOT NULL REFERENCES tasks(id),
  change_id            TEXT NOT NULL REFERENCES changes(id),
  factors              JSONB NOT NULL,
  factors_unavailable  JSONB NOT NULL DEFAULT '[]',
  combined_priority    DOUBLE PRECISION NOT NULL,
  label                TEXT NOT NULL CHECK (label IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.2 Phase-1 factor extractors (each returns `number | null`; null = unavailable)

| Factor | Phase-1 heuristic | Data source |
|---|---|---|
| `risk` | verification report: FAILED=0.9, FLAKY=0.6, TIMED_OUT=0.7, PASSED=0.1; +0.1 if secrets-adjacent path touched (`*.env*`, `*credentials*`), capped 1.0 | `verification_reports`, `artifacts.path` |
| `impact` | min(1, files_touched / 10) blended 50/50 with path criticality (paths under `packages/domain` or `migrations/` count double) | `artifacts`, DiffEngine |
| `novelty` | 1.0 if task type/path combination never seen in `attention_assessments` history; 0.2 if seen ≥3×; linear between | own table history |
| `complexity` | min(1, (addedLines + removedLines) / 500) blended with trajectory steps: min(1, steps/20); 50/50 | DiffEngine counts, `trajectory_steps` |
| `confidenceScore` | agent self-report is untrusted by design; proxy = 1 − risk_proxy where risk_proxy derives from verification + retry count (`retry_log` rows × 0.15). Passed *into* the formula as `confidence_score` — note the formula uses `(1 − confidence_score)`, so shakier runs score higher priority | verification + `retry_log` |

All extractors are pure functions over a fetched `ScoringInput` — unit-testable without DB.

### 2.3 Scoring (exact, with redistribution)

```ts
export function computePriority(f: FactorScores, unavailable: string[]): number {
  const avail = {
    risk: unavailable.includes('risk') ? null : f.risk,
    impact: unavailable.includes('impact') ? null : f.impact,
    novelty: unavailable.includes('novelty') ? null : f.novelty,
    complexity: unavailable.includes('complexity') ? null : f.complexity,
    confidence: unavailable.includes('confidence') ? null : f.confidenceScore,
  };
  const wTotal = Object.entries(avail)
    .reduce((s, [k, v]) => s + (v === null ? 0 : PRIORITY_WEIGHTS[k as keyof typeof PRIORITY_WEIGHTS]), 0);
  const raw =
    w('risk', avail.risk) + w('impact', avail.impact) + w('novelty', avail.novelty) +
    w('complexity', avail.complexity) + w('confidence', avail.confidence === null ? null : 1 - avail.confidence);
  return raw / wTotal;   // redistribute missing weights proportionally
}
export function labelFor(p: number) {
  return p >= 0.80 ? 'CRITICAL' : p >= 0.60 ? 'HIGH' : p >= 0.30 ? 'MEDIUM' : 'LOW';
}
```

**Guard:** if all factors unavailable → refuse to score, log, default label `HIGH` (fail toward human attention, never away).

### 2.4 Trigger point

`AttentionSubscriber` on the bus: `task.state_changed` where `to = 'AWAITING_REVIEW'` → extract → compute → insert `attention_assessments` → publish `attention.assessment_created` (payload: assessment id, label, priority). Day-19 routing consumes this; Day-22 review queue reads it.

---

## 3. Tasks

- [ ] **3.1** Scaffold `packages/attention-engine` (R4 deps only) + migration `0018_attention.sql`. (45 min)
- [ ] **3.2** `ScoringInput` fetcher (joins reports/diffs/trajectory/retry_log). (1 h)
- [ ] **3.3** Five pure extractors + unit tests each (boundary values, null cases). (1.5 h)
- [ ] **3.4** `computePriority` + redistribution + labels + all-unavailable guard. Golden tests incl. the spec's worked examples and a regression test proving low confidence ⇒ higher priority. (1 h)
- [ ] **3.5** `AttentionSubscriber` + `attention.assessment_created` event + bootstrap wiring + wiring-map. (45 min)
- [ ] **3.6** Integration: seeded task reaching AWAITING_REVIEW → row persisted with plausible factor values. (45 min)

---

## 4. Deliverables

| File | Description |
|---|---|
| `packages/attention-engine/src/scoring.ts` | Pure computePriority + labels (corrected formula) |
| `packages/attention-engine/src/factors.ts` | Five Phase-1 extractors |
| `packages/attention-engine/src/attention-subscriber.ts` | AWAITING_REVIEW trigger + event |
| `packages/attention-engine/migrations/0018_attention.sql` | attention_assessments table |

---

## 5. Acceptance Criteria

- [ ] Formula regression test: `confidenceScore = 0.9` yields *lower* priority than `confidenceScore = 0.2` with other factors fixed (guards the v0.1 spec bug).
- [ ] Unavailable factor → 0.5 not used; weight redistributed over remaining factors; name recorded in `factors_unavailable`.
- [ ] Label boundaries exact: 0.80→CRITICAL, 0.79→HIGH, 0.60→HIGH, 0.59→MEDIUM, 0.30→MEDIUM, 0.29→LOW.
- [ ] Task reaching AWAITING_REVIEW → assessment row + `attention.assessment_created` event (integration).
- [ ] Weights sum to 1.0 (static assertion test).
- [ ] `pnpm test && pnpm lint` green; boundary tests green.

---

## 6. Notes & Pitfalls

- **Do not "improve" the weights today.** 0.35/0.25/0.15/0.10/0.15 are declared placeholders in the spec; tuning belongs to Day-19 feedback loop + Phase 2 calibration. Changing them silently now breaks the spec's worked examples.
- **`confidenceScore` is a proxy,** and the spec says so — document the proxy in code comments so Phase 2's calibration replaces one clearly-marked function, not archaeology.
- **Determinism:** scoring must be a pure function of stored data — no `Date.now()` inside extractors (use row timestamps), or assessments stop being reproducible/auditable.
- **Re-assessment on rework:** each attempt entering AWAITING_REVIEW gets its own assessment row (append-only) — never update in place; Day-19 uses the latest.
- **Next:** [Day 19 — AttentionPolicy Rules, Routing & Alert Fatigue](day-19.md) turns these assessments into routing decisions with the spec's §4.1 alert-fatigue controls.

---

*Prev: [Day 17 — Evidence Storage, Provenance Linking & Diff Engine](day-17.md) | Next: [Day 19 — AttentionPolicy Rules, Routing & Alert Fatigue](day-19.md)*
