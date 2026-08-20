# @harness/review — Human Review Interface

## Trạng thái hiện tại

Stubs: `src/index.ts` chỉ export string `'review'`. Chưa có implementation.

---

## Mục đích

Queue + decision API cho human reviewer — cho phép reviewer xem assessment, diff, evidence rồi quyết định APPROVE/REJECT.

---

## Công việc cần làm

### Day 22 — Review backend

**API routes** (logic trong package, routes trong `apps/api`):

```typescript
// src/review-service.ts
export class ReviewService {
  async listQueue(status: 'QUEUED' | 'CLAIMED' = 'QUEUED'): Promise<ReviewQueueItem[]> {
    // SELECT from review_queue ORDER BY position (priority desc, FIFO)
  }

  async getItemDetail(queueId: string): Promise<ReviewItemDetail> {
    // Compose: assessment + verification report + diffs + task summary
    // Read-only joins, no writes
  }

  async claim(queueId: string, reviewerId: string): Promise<void> {
    // Optimistic concurrency: UPDATE ... WHERE status = 'QUEUED'
    const result = await this.db.update(reviewQueue)
      .set({ status: 'CLAIMED', claimed_by: reviewerId, claimed_at: new Date() })
      .where(eq(reviewQueue.id, queueId))
      .andWhere(eq(reviewQueue.status, 'QUEUED'));

    if (result.count === 0n) throw new QueueConflictError(queueId);
  }

  async decide(queueId: string, input: DecisionInput): Promise<void> {
    const item = await this.mustGet(queueId);
    assertStatus(item, 'CLAIMED'); // only claimant may decide

    await this.db.transaction(async (trx) => {
      await trx.update(reviewQueue).set({ status: 'DECIDED' }).where(eq(reviewQueue.id, queueId));
      await trx.insert(decisions).values({ queueId, ...input });
      await transitionTask(trx, item.taskId, input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', 'AWAITING_REVIEW');
    });

    this.bus.publish({ type: 'review.decision_submitted', payload: { taskId: item.taskId, decision: input.decision } });
    await this.attention.reportAssessmentFeedback(item.assessmentId, input.wasUseful, input.comment);
  }

  async drop(queueId: string, reviewerId: string, rationale: string): Promise<void> {
    // Drop requires rationale — never silent
  }
}
```

### Day 22 — Decision flow

```
APPROVE → task APPROVED → Change REVIEWED → (Day 24) trigger merge
REJECT  → task REJECTED → Change REVIEWED → (Day 24) trigger REWORK → QUEUED
```

Event propagation:
- `review.decision_submitted` → orchestrated by subscriber trong `artifact-tracker` để flip Change status
- Đồng thời trigger task state transition

### Day 23 — Web UI

React + Vite component:

```
src/
├── ReviewQueue.tsx        # List of queue items, ordered by priority
├── ReviewItem.tsx         # Detail view: assessment factors + diffs + evidence
├── DecisionForm.tsx       # Approve/Reject/RequestChanges with rationale
└── ProvenanceChain.tsx    # Full provenance timeline
```

### Day 24 — Merge / Rework flow

```typescript
// In orchestrator, on APPROVE event:
// - Trigger git merge of agent's branch into main
// - Record commit_sha in Change.metadata
// - Update Artifact status to MERGED

// In orchestrator, on REJECT event:
// - Create new attempt (attempt_number + 1)
// - Transition task to REWORK → QUEUED
```

---

## Dependency rule

```
packages/review → import @harness/domain, @harness/event-bus, @harness/db, @harness/attention-engine
                → ONLY engine import allowed: attention-engine (feedback loop)
```

---

## Queue detail payload

`GET /api/review/queue/:id` composes:
- Assessment (factors, label, combined_priority, rule_id, policy_version)
- Verification report + check results + evidence ids
- File diffs from DiffEngine cache
- Task summary + attempt_number

---

## Files cần tạo

```
src/
├── index.ts
├── types.ts                    # ReviewQueueItem, HumanDecision, DecisionInput
├── review-service.ts           # claim / decide / drop operations
├── queue-repository.ts         # DB queries for queue list/detail
└── __tests__/
    ├── review-service.test.ts
    └── queue-repository.test.ts
```
