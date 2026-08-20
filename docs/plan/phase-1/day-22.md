# Day 22 — Review Backend: Queue API & Decisions

| | |
|---|---|
| **Week** | 4 — Human Loop & E2E |
| **Spec refs** | Spec 6 §4 (Routing), Spec 2 §7 (AWAITING_REVIEW transitions), Spec 5 §4 (Change REVIEWED) |
| **Estimated effort** | 6 h |
| **Prerequisites** | Day 19 (review_queue, reportAssessmentFeedback), Day 14 (ChangeStatusSubscriber), Day 06 (state machine) |

---

## 1. Objectives

1. Build the **Review backend package** (`@harness/review`, rule R6) exposing the queue to `apps/api`.
2. Implement **claim / decide / drop** operations with optimistic concurrency (no double-claim).
3. On decision: publish `review.decision_submitted` (consumed by Day-14 ChangeStatusSubscriber → Change REVIEWED) and drive the task transition (APPROVED or REJECTED — Day 24 wires the follow-through).
4. Call `reportAssessmentFeedback` (Day 19) so every decision feeds the alert-fatigue loop.

> **Why this matters:** this is the moment a human enters the loop. Everything before Day 22 exists to make this screen short, prioritized, and evidence-backed. The API must be boring and correct — all the intelligence is upstream.

---

## 2. Design Decisions

### 2.1 API surface (Fastify routes in `apps/api`, logic in `@harness/review`)

| Method | Route | Description |
|---|---|---|
| GET | `/api/review/queue?status=QUEUED` | List queue items ordered by `position` (priority desc, FIFO) |
| GET | `/api/review/queue/:id` | Item detail: assessment factors, diffs (Day 17), verification report + evidence links |
| POST | `/api/review/queue/:id/claim` | Reviewer claims item (QUEUED → CLAIMED) |
| POST | `/api/review/queue/:id/decide` | Submit decision `{ decision: 'APPROVE' \| 'REJECT', rationale, wasUseful }` |
| POST | `/api/review/queue/:id/drop` | Drop item (requires rationale; recorded, never silent — Day-19 rule) |

### 2.2 Claim with optimistic concurrency

Same pattern as Day-06 task transitions — guarded UPDATE:

```ts
const claimed = await db.updateTable('review_queue')
  .set({ status: 'CLAIMED', claimed_by: reviewerId, claimed_at: new Date() })
  .where('id', '=', id)
  .where('status', '=', 'QUEUED')          // guard: someone else may have claimed
  .executeTakeFirst();
if (claimed.numUpdatedRows === 0n) throw new QueueConflictError(id); // 409
```

### 2.3 Decision flow

```ts
async decide(queueId: string, input: DecisionInput): Promise<void> {
  const item = await this.mustGet(queueId);
  assertStatus(item, 'CLAIMED');                       // only claimant may decide
  await this.db.transaction().execute(async (trx) => {
    await setQueueStatus(trx, queueId, 'DECIDED');
    await insertDecision(trx, { queueId, ...input });  // review_decisions table (0022)
    await transitionTask(trx, item.taskId,
      input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      { expected: 'AWAITING_REVIEW' });                // Day-06 guarded transition
  });
  this.bus.publish(makeEvent('review.decision_submitted', {
    taskId: item.taskId, decision: input.decision, rationale: input.rationale,
  }));
  // Day-19 feedback loop — outside transaction, best-effort
  await this.attention.reportAssessmentFeedback(item.assessmentId, input.wasUseful, input.comment);
}
```

- `review.decision_submitted` → Day-14 ChangeStatusSubscriber flips Change PENDING/VERIFIED → REVIEWED. One event, two consumers (task state via API, change status via subscriber) — consistent with the event-driven status rule.
- Migration `0022_review.sql`: `review_decisions` (id, queue_id FK, decision, rationale, reviewer_id, created_at) + `claimed_by`/`claimed_at` columns on `review_queue`.

### 2.4 Queue detail payload

`GET /:id` composes (read-only joins, no new writes):
- assessment (factors, label, combined_priority, rule_id, policy_version)
- verification report + check results + evidence ids (Day 15–17)
- file diffs from DiffEngine cache (Day 17)
- task summary + attempt_number

This is exactly what the Day-23 UI renders — keep the payload shape stable.

---

## 3. Tasks

- [ ] **3.1** Scaffold `packages/review` + migration `0022_review.sql`. (1 h)
- [ ] **3.2** Queue list/detail queries (position ordering, composed detail payload). (1 h)
- [ ] **3.3** Claim with guarded UPDATE + 409 conflict. (45 min)
- [ ] **3.4** Decide: transaction + task transition + event + feedback call. (1.5 h)
- [ ] **3.5** Drop with mandatory rationale. (30 min)
- [ ] **3.6** Fastify routes + DI wiring in `bootstrap.ts` + wiring-map.md update. (45 min)
- [ ] **3.7** Tests: double-claim → 409; decide publishes event and transitions task; feedback recorded; drop requires rationale. (1 h)

---

## 4. Deliverables

| File | Description |
|---|---|
| `packages/review/src/{service,queries,decide}.ts` | Review backend |
| `packages/review/migrations/0022_review.sql` | review_decisions + claim columns |
| `apps/api/src/routes/review.ts` | Fastify routes |

---

## 5. Acceptance Criteria

- [ ] Two concurrent claims → exactly one succeeds; loser gets 409.
- [ ] APPROVE → task AWAITING_REVIEW→APPROVED; REJECT → →REJECTED; both publish `review.decision_submitted` and record feedback.
- [ ] Change status flips to REVIEWED via the Day-14 subscriber (no direct writes from review package to `changes`).
- [ ] Queue list is ordered by position; detail payload contains assessment + report + diffs.
- [ ] `pnpm test && pnpm lint` green; boundary tests green (review imports only domain/event-bus/db/di).

---

## 6. Notes & Pitfalls

- **Never write `changes.status` from the review package** — ChangeStatusSubscriber (Day 14) is the sole writer; the review backend only emits events. This keeps status derivation auditable in one place.
- **Decide-before-claim is an error**, not a convenience — enforce CLAIMED precondition; anonymous drive-by decisions destroy accountability.
- **Feedback is best-effort** — a failure in `reportAssessmentFeedback` must not roll back the decision; log and continue (Day 27 observability will surface it).
- **Next:** [Day 23 — Review UI: Queue & Diff View](day-23.md) puts this API in front of a human.

---

*Prev: [Day 21 — Context Delivery, Freshness & Week 3 Checkpoint](day-21.md) | Next: [Day 23 — Review UI: Queue & Diff View](day-23.md)*
