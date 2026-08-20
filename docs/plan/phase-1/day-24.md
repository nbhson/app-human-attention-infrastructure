# Day 24 — Decision Flow: Merge on Approve, Rework on Reject

| | |
|---|---|
| **Week** | 4 — Human Loop & E2E |
| **Spec refs** | Spec 2 §7 (APPROVED→COMPLETED, REJECTED→REWORK), Spec 5 §3.1 (Git relationship), §4 (MERGED status) |
| **Estimated effort** | 6 h |
| **Prerequisites** | Day 22 (decision API), Day 14 (artifact/change statuses), Day 06 (state machine) |

---

## 1. Objectives

1. Wire the **approve path**: APPROVED → merge artifacts into the target branch → record commit SHA → task COMPLETED, artifacts MERGED.
2. Wire the **reject path**: REJECTED → REWORK with rationale → re-queue (attempt_number + 1) or FAILED when `max_attempts` exhausted.
3. Keep the **Tracker/Git boundary** from the Day-14 ADR: the harness records merge outcomes; Git remains post-merge source of truth.
4. Close the loop: every task that entered AWAITING_REVIEW reaches a terminal or re-queued state with full audit trail.

> **Why this matters:** Days 1–23 built the machinery to get a verified, prioritized change in front of a human. Day 24 makes the human's decision * consequential* — code lands or work loops back, with no orphaned states and no silent outcomes.

---

## 2. Design Decisions

### 2.1 Approve path (MergeService in `apps/api` — apps may import anything, R5)

```ts
export class MergeService {
  async onApproved(taskId: TaskID): Promise<void> {   // subscribed to task.state_changed → APPROVED
    const change = await this.tracker.getChange(taskId);        // UNIQUE(task_id, attempt_number)
    const artifacts = await this.tracker.getArtifacts(change.id); // status REVIEWED expected
    // Phase 1 merge = apply snapshot contents to the working repo, then git commit.
    // Git operations live in apps/api (a small GitAdapter), NEVER in artifact-tracker (ADR).
    const commitSha = await this.git.applyAndCommit(artifacts, {
      message: `harness: task ${taskId} (attempt ${change.attemptNumber})\n\nReviewed-by: ${change.reviewerId}`,
    });
    await this.db.transaction().execute(async (trx) => {
      await setChangeMetadata(trx, change.id, { commit_sha: commitSha });   // jsonb, per Day-14
      await setArtifactStatus(trx, change.id, 'MERGED');                    // guarded UPDATE
      await transitionTask(trx, taskId, 'COMPLETED', { expected: 'APPROVED' });
    });
    this.bus.publish(makeEvent('artifact.merged', { taskId, commitSha }));
  }
}
```

- **Failure handling:** merge conflict or git error → task → AWAITING_HUMAN_INTERVENTION with reason `MERGE_FAILED` (never silently retry a git operation).
- **Idempotency:** subscriber is keyed on the APPROVED transition event; guarded UPDATEs make a duplicate event a no-op.

### 2.2 Reject path (ReworkService)

```ts
async onRejected(taskId: TaskID, rationale: string): Promise<void> {
  const task = await this.mustGetTask(taskId);
  if (task.attemptNumber >= task.maxAttempts) {                 // default 3 (Day 06)
    await transitionTask(this.db, taskId, 'FAILED', { expected: 'REJECTED' });
    this.bus.publish(makeEvent('task.failed', { taskId, reason: 'MAX_ATTEMPTS_EXHAUSTED' }));
    return;
  }
  await this.db.transaction().execute(async (trx) => {
    await transitionTask(trx, taskId, 'REWORK', { expected: 'REJECTED' });
    await insertReworkNote(trx, taskId, rationale);             // feeds next attempt's prompt
  });
  // Dispatcher (Day 08) moves REWORK → QUEUED on its next pass;
  // REWORK→QUEUED is the ONLY transition that increments attempt_number (Day-06 rule),
  // which also rolls the idempotency key `task_id:attempt_number`.
}
```

The rationale is injected into the next attempt's EXECUTE prompt ("Previous attempt rejected because: …") — rejection without feedback would just re-roll the dice.

### 2.3 State-machine check

All transitions used today already exist in the Day-06 table: `AWAITING_REVIEW→APPROVED`, `APPROVED→COMPLETED`, `AWAITING_REVIEW→REJECTED`, `REJECTED→REWORK`, `REJECTED→FAILED`, `REWORK→QUEUED`. **No new transitions** — if you think you need one, you're wrong; re-read Spec 2.

---

## 3. Tasks

- [ ] **3.1** `GitAdapter` in `apps/api` (apply snapshot contents + commit; conflict detection). (1.5 h)
- [ ] **3.2** `MergeService` subscriber + transaction + `artifact.merged` event. (1.5 h)
- [ ] **3.3** `ReworkService` subscriber + rationale persistence + max-attempts guard. (1 h)
- [ ] **3.4** Inject rationale into next attempt's prompt (AgentRunner change). (45 min)
- [ ] **3.5** Tests: approve → MERGED + COMPLETED + commit SHA recorded; reject → REWORK → QUEUED with attempt 2; reject at max attempts → FAILED; merge conflict → AWAITING_HUMAN_INTERVENTION; duplicate event → no-op. (1.5 h)

---

## 4. Deliverables

| File | Description |
|---|---|
| `apps/api/src/services/{merge,git-adapter,rework}.ts` | Decision follow-through |
| `packages/agent-runtime/src/runner.ts` (edit) | Rework rationale in prompt |

---

## 5. Acceptance Criteria

- [ ] Approve → artifacts MERGED, change metadata has `commit_sha`, task COMPLETED, `artifact.merged` published.
- [ ] Reject → task REWORK→QUEUED, `attempt_number` incremented exactly once, rationale visible in next prompt.
- [ ] Reject at `max_attempts` → task FAILED with reason recorded.
- [ ] Merge conflict → AWAITING_HUMAN_INTERVENTION, no partial commit.
- [ ] No git invocation from any `packages/*` engine (lint rule + code review).
- [ ] `pnpm test && pnpm lint` green; boundary tests green.

---

## 6. Notes & Pitfalls

- **Merge is the only place the harness writes to the "real" repo** — keep it in one service, logged, and conflict-safe. Scattered git writes will corrupt the audit story.
- **Attempt increment discipline:** only REWORK→QUEUED increments (Day 06). If you find yourself incrementing elsewhere, the state machine is being bypassed.
- **Rationale is data, not a comment** — store it in a column, not inside a free-text JSON blob, so Day-27 audit queries can aggregate rejection reasons.
- **Next:** [Day 25 — E2E Vertical Slice: Happy Path](day-25.md) runs the whole machine end-to-end for the first time.

---

*Prev: [Day 23 — Review UI: Queue & Diff View](day-23.md) | Next: [Day 25 — E2E Vertical Slice: Happy Path](day-25.md)*
