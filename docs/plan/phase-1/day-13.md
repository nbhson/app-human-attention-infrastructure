# Day 13 — POST/GET /api/reviews + decision route

| | |
|---|---|
| **Week** | W2 — Review ingest core |
| **Spec refs** | Spec 8 §1 (Human Review Interface), Spec 1 §2 (human decision) |
| **Estimated effort** | 6h |
| **Prerequisites** | Day 12 (`ReviewIngestService`) |

---

## 1. Objectives

- Expose the review loop over REST: `POST /api/reviews` (paste PR URL + optional ticket URL, returns the report), `GET /api/reviews/:id`, and a decision route.
- Wire the decision route to `HumanDecisionType` (`APPROVED` / `REJECTED` / `REQUEST_CHANGES`), recording the decision with `evidenceViewed` and a reason.
- Return the full report (summary, verdict, findings, suggestions) for the UI, and list recent reviews for the queue.
- Enforce request validation (Fastify schemas) and map provider/agent errors to clean 4xx/5xx responses (no token leakage in errors).

## 2. Design Decisions

- The API is a thin controller over the services: parse → validate → call `ReviewIngestService`/decision service → serialize. No review logic lives at the route layer.

```ts
POST   /api/reviews            { prUrl, ticketUrl? }        → 201 ReviewReport
GET    /api/reviews/:id        → ReviewReport + findings + suggestions
GET    /api/reviews            → recent reviews (queue feed)
POST   /api/reviews/:id/decision  { decision, reason, evidenceViewed } → 200 Decision
```

- Decisions are a closed set; malformed/unknown decision values are rejected at validation, not silently coerced. Every decision emits `review.decision_submitted`.

## 3. Tasks

### 3.1 Routes + schemas (150 min)
- [ ] `apps/api/src/routes/reviews.ts` — POST/GET + decision
- [ ] Fastify JSON schemas for request bodies + params

### 3.2 Decision service (120 min)
- [ ] `apps/api/src/services/decision-service.ts` — validate + record + emit `review.decision_submitted`
- [ ] Persist `HumanDecision` (joins to task + report)

### 3.3 Serialization + tests (90 min)
- [ ] Response DTOs; error mapper (no token in errors); route integration tests with `MockLLM`

## 4. Deliverables

| File | Description |
|------|-------------|
| `apps/api/src/routes/reviews.ts` | Review + decision routes |
| `apps/api/src/services/decision-service.ts` | Decision recording |
| `apps/api/src/schemas/reviews.schema.ts` | Request validation schemas |
| `apps/api/src/errors/mapper.ts` | Clean error mapping |

## 5. Acceptance Criteria

- [ ] `pnpm --filter @harness/api test` passes route integration tests
- [ ] `POST /api/reviews` with `prUrl` returns 201 with a full persisted report (via `MockLLM`)
- [ ] `POST /api/reviews/:id/decision` with `REQUEST_CHANGES` persists the decision and emits `review.decision_submitted`
- [ ] Invalid decision value → 400; provider error → 502 with a redacted message

## 6. Notes & Pitfalls

- The UI (Day 22) consumes exactly these DTOs — freeze the field names now (`prUrl`, `prTitle`, `summary`, `overallVerdict`, `findings`, `suggestions`).
- Decision routes record human intent; they must not mutate the AI report or re-run the review.

---

*Next: [Day 14 — Week 2 checkpoint — review vertical slice (GitHub + real/mock LLM)](day-14.md)*