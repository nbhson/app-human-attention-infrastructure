# Day 21 — Week 3 checkpoint — context delivery, freshness check

| | |
|---|---|
| **Week** | W3 — Trust pipeline |
| **Spec refs** | Spec 4 §3 (freshness), Spec 9 §1 (evidence), plan README §6 |
| **Estimated effort** | 6h |
| **Prerequisites** | Days 15–20 (verification, evidence, attention, context) |

---

## 1. Objectives

- Wire the trust pipeline end-to-end: review → independent verification → evidence → scoring → routing → context bundle delivery.
- Add a **freshness check**: ensure the context/evidence points at the current `contentHash` of the change, flagging stale reviews.
- Demonstrate the Week 3 slice: a review arrives with evidence, an attention label, and the exact context bundle the reviewer saw (queryable).
- Fix integration debt surfaced by wiring the pipeline; add an integration test covering the full trust chain.

## 2. Design Decisions

- Freshness is a `contentHash` equality check: if the change's hash moved after evidence was recorded, the review is `STALE` and the UI must mark it, rather than silently trusting old evidence.

```ts
export type Freshness = 'FRESH' | 'STALE';
export function freshness(evidenceHash: string, currentHash: string): Freshness {
  return evidenceHash === currentHash ? 'FRESH' : 'STALE';
}
```

- The checkpoint proves the *trust* loop — verification evidence is recorded and linked, attention routes it, context is served to the reviewer — but the human still decides at Day 22+.

## 3. Tasks

### 3.1 Pipeline wiring (150 min)
- [ ] Wire verification → evidence → attention → context in `apps/api` bootstrap
- [ ] Persist the delivered `ContextBundle` (or its hash) on the review for audit

### 3.2 Freshness (120 min)
- [ ] `freshness.ts` + `STALE` flag propagation to the report/queue
- [ ] Integration test: change the diff after verification → review marked `STALE`

### 3.3 Checkpoint test (90 min)
- [ ] `trust-pipeline.e2e.ts`: full chain with prod-like fixtures + `MockLLM`

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/services/trust-pipeline.ts` | Pipeline orchestration |
| `apps/api/src/services/freshness.ts` | `contentHash` freshness check |
| `apps/api/test/trust-pipeline.e2e.ts` | Week 3 checkpoint test |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes the trust-pipeline E2E
- [ ] A review carries evidence, an attention label, and a recorded `ContextBundle`
- [ ] A `STALE` review is flagged when the change's `contentHash` diverges from its evidence

## 6. Notes & Pitfalls

- Freshness depends on the deterministic diff hash from Day 17 — normalize before hashing lest every fetch look stale.
- This checkpoint *ends* Week 3 feature work; the remaining days add UI, E2E paths, and hardening.

---

*Next: [Day 22 — Review UI: queue + diff view + AI report & fix-suggestions panels](day-22.md)*