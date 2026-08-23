# Day 24 — E2E — failure paths + provenance query UI

| | |
|---|---|
| **Week** | W4 — Human loop + E2E |
| **Spec refs** | Spec 1 §3/§7 (claim ≠ evidence, provenance), Spec 9 §1 |
| **Estimated effort** | 7h |
| **Prerequisites** | Day 23 (happy path + provenance query) |

---

## 1. Objectives

- Cover the **failure paths** end-to-end: verification failure, unmapped provider error, malformed review, and a `STALE` review are each surfaced and recorded, never silent.
- Add a **provenance query UI** that renders the chain `pr_fetched → report_created → verification.completed → item_routed → decision_submitted` for a review.
- Prove the reject path: a verification failure is flagged in the report and the human can still record a decision against it.

## 2. Design Decisions

- Failure is *evidence*, not an exception to hide: a failed verification emits `verification.completed` with `status: FAIL` and lowers confidence, and the report is flagged rather than suppressed.

```ts
// failure-path assertions
verify-fail fixture → verification.completed(status: FAIL)
                   → attention.item_routed(route: REVIEW_REQUIRED)
                   → report flagged 'verification-failed'
                   → POST decision { decision: 'REJECTED' } succeeds
```

- The provenance UI is a read-only trace renderer over the `event_log` for a `correlation_id`; no editing, no write path.

## 3. Tasks

### 3.1 Failure-path E2E (180 min)
- [ ] `apps/api/test/failure-paths.e2e.ts` — verify-fail, provider-error, malformed-review, stale-review cases

### 3.2 Provenance query (120 min)
- [ ] `GET /api/reviews/:id/provenance` route returning the ordered event chain
- [ ] `apps/web` provenance trace panel

### 3.3 Tests + docs (120 min)
- [ ] Assert reject path works against a `FAIL`-flagged report; document failure semantics

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/test/failure-paths.e2e.ts` | Failure-path E2E |
| `apps/api/src/routes/provenance.ts` | Provenance route |
| `apps/web/src/components/provenance.tsx` | Trace renderer |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes failure-path E2E
- [ ] A verification failure is flagged in the report and routes `REVIEW_REQUIRED`
- [ ] The provenance UI renders the ordered chain, and a decision can be recorded against a `FAIL`-flagged review
- [ ] Provider errors and malformed reviews return clean 4xx/5xx with no secrets

## 6. Notes & Pitfalls

- The provenance route reads only the append-only `event_log` — never recompute from current-state tables.
- The reject path is a first-class demo case (Day 30 success criteria list it), so assert it specifically.

---

*Next: [Day 25 — Observability: logs, correlation IDs, audit queries](day-25.md)*