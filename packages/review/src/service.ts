/**
 * `ReviewService` (day-22 §2) — the review backend behind `apps/api`'s routes.
 *
 * Claim / decide / drop are the only mutations, and every one is a *guarded*
 * write over `review_queue` status (optimistic concurrency), so two recent claims
 * resolve to exactly one winner and everything else is a 409/state error. The
 * service never touches `changes.status` — that stays the ChangeStatusSubscriber's
 * job (day-14 §2.5); it only publishes `review.decision_submitted` and lets the
 * subscriber flip the change to REVIEWED.
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { assessments, decisions, reviewQueue, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import {
  brand,
  EventType,
  HumanDecisionType,
  newDecisionID,
  ReviewQueueStatus,
  TaskStatus,
} from '@harness/domain';
import type {
  DecisionSubmittedPayload,
  HumanDecisionType as DecisionType,
  ReviewerID,
  ReviewQueueItemID,
} from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

import {
  MissingRationaleError,
  QueueConflictError,
  QueueItemNotFoundError,
  QueueStateError,
} from './types.js';
import type {
  DecisionInput,
  DropInput,
  FeedbackReporter,
  QueueItem,
  QueueItemDetail,
  TaskTransition,
} from './types.js';

/** The row the service re-loads before acting (queue + its assessment). */
interface QueueRow {
  readonly id: string;
  readonly task_id: string;
  readonly assessment_id: string;
  readonly change_id: string;
  readonly action: string;
  readonly policy_version: number;
  readonly rule_id: string;
  readonly position: number;
  readonly status: string;
  readonly claimed_by: string | null;
  readonly claimed_at: Date | null;
  readonly created_at: Date;
  readonly label: string;
  readonly combined_priority: number;
}

/** The columns shared by list + detail reads (queue joined to its assessment). */
const QUEUE_COLUMNS = {
  id: reviewQueue.id,
  task_id: reviewQueue.task_id,
  assessment_id: reviewQueue.assessment_id,
  change_id: assessments.change_id,
  action: reviewQueue.action,
  policy_version: reviewQueue.policy_version,
  rule_id: reviewQueue.rule_id,
  position: reviewQueue.position,
  status: reviewQueue.status,
  claimed_by: reviewQueue.claimed_by,
  claimed_at: reviewQueue.claimed_at,
  created_at: reviewQueue.created_at,
  label: assessments.label,
  combined_priority: assessments.combined_priority,
} as const;

export class ReviewService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly taskTransition: TaskTransition,
    private readonly reportFeedback: FeedbackReporter,
  ) {}

  /** List the queue in priority order: ascending `position` is FIFO (day-22 §2.1). */
  async listQueue(): Promise<QueueItem[]> {
    const rows = await this.db
      .select(QUEUE_COLUMNS)
      .from(reviewQueue)
      .innerJoin(assessments, eq(assessments.id, reviewQueue.assessment_id))
      .orderBy(asc(reviewQueue.position));
    return rows.map(toQueueItem);
  }

  /** Compose the read-only detail payload (day-22 §2.4). */
  async getDetail(queueId: ReviewQueueItemID): Promise<QueueItemDetail> {
    const row = await this.mustGetRow(queueId);

    const taskRows = await this.db
      .select({ title: tasks.title, state: tasks.state })
      .from(tasks)
      .where(eq(tasks.id, row.task_id))
      .limit(1);

    const decisionRows = await this.db
      .select({
        decision: decisions.decision,
        reviewer_id: decisions.reviewer_id,
        rationale: decisions.rationale,
        created_at: decisions.created_at,
      })
      .from(decisions)
      .where(eq(decisions.assessment_id, row.assessment_id))
      .orderBy(desc(decisions.created_at))
      .limit(1);

    const latest = decisionRows[0];
    return {
      ...toQueueItem(row),
      label: row.label,
      combinedPriority: row.combined_priority,
      ruleId: row.rule_id,
      policyVersion: row.policy_version,
      taskTitle: taskRows[0]?.title ?? '',
      taskState: taskRows[0]?.state ?? '',
      decision: latest
        ? {
            decision: latest.decision as DecisionType,
            reviewerId: brand(latest.reviewer_id, 'ReviewerID'),
            rationale: latest.rationale,
            at: latest.created_at,
          }
        : null,
    };
  }

  /** Claim a QUEUED item for a reviewer; a second claim loses with a 409 (§2.2). */
  async claim(queueId: ReviewQueueItemID, reviewerId: ReviewerID): Promise<QueueItemDetail> {
    const updated = await this.db
      .update(reviewQueue)
      .set({ status: ReviewQueueStatus.Claimed, claimed_by: reviewerId, claimed_at: new Date() })
      .where(and(eq(reviewQueue.id, queueId), eq(reviewQueue.status, ReviewQueueStatus.Queued)))
      .returning({ id: reviewQueue.id });

    if (updated.length === 0) {
      throw new QueueConflictError(queueId);
    }
    return this.getDetail(queueId);
  }

  /** Submit a decision on a CLAIMED item (day-22 §2.3). */
  async decide(queueId: ReviewQueueItemID, input: DecisionInput): Promise<QueueItemDetail> {
    const row = await this.mustGetRow(queueId);
    if (row.status !== ReviewQueueStatus.Claimed) {
      throw new QueueStateError(queueId, ReviewQueueStatus.Claimed, row.status);
    }

    const decision =
      input.decision === 'APPROVE' ? HumanDecisionType.Approved : HumanDecisionType.Rejected;
    const target = input.decision === 'APPROVE' ? TaskStatus.Approved : TaskStatus.Rejected;

    // 1. Guarded queue flip: CLAIMED → DECIDED (a second decide is a state error).
    const flipped = await this.db
      .update(reviewQueue)
      .set({ status: ReviewQueueStatus.Decided })
      .where(and(eq(reviewQueue.id, queueId), eq(reviewQueue.status, ReviewQueueStatus.Claimed)))
      .returning({ id: reviewQueue.id });
    if (flipped.length === 0) {
      throw new QueueStateError(queueId, ReviewQueueStatus.Claimed, row.status);
    }

    // 2. Record the decision (auditable, never silent).
    const decisionId = newDecisionID();
    const changeId = brand(row.change_id, 'ChangeID');
    const assessmentId = brand(row.assessment_id, 'AssessmentID');
    await this.db.insert(decisions).values({
      id: decisionId,
      change_id: changeId,
      assessment_id: assessmentId,
      decision,
      reviewer_id: input.reviewerId,
      rationale: input.rationale,
    });

    // 3. Drive the task transition (injected seam → TaskService).
    await this.taskTransition.transitionTask(brand(row.task_id, 'TaskID'), target, 'human', {
      rationale: input.rationale,
      expectedFrom: TaskStatus.AwaitingReview,
    });

    // 4. Publish the event; ChangeStatusSubscriber flips the change → REVIEWED.
    const payload: DecisionSubmittedPayload = {
      decision_id: decisionId,
      change_id: changeId,
      decision,
      reviewer_id: input.reviewerId,
    };
    this.bus.publish(
      createEvent(EventType.DecisionSubmitted, brand(row.task_id, 'CorrelationID'), payload),
    );

    // 5. Feed the alert-fatigue loop — best-effort, must not roll back the decision.
    try {
      await this.reportFeedback.reportAssessmentFeedback(
        assessmentId,
        input.wasUseful,
        input.comment,
      );
    } catch (error) {
      console.error('[review] failed to record feedback (best-effort):', error);
    }

    return this.getDetail(queueId);
  }

  /** Drop a QUEUED/CLAIMED item; the rationale is recorded, never silent (§2.1). */
  async drop(queueId: ReviewQueueItemID, input: DropInput): Promise<void> {
    if (input.rationale.trim().length === 0) {
      throw new MissingRationaleError();
    }
    const row = await this.mustGetRow(queueId);

    const updated = await this.db
      .update(reviewQueue)
      .set({ status: ReviewQueueStatus.Dropped })
      .where(
        and(
          eq(reviewQueue.id, queueId),
          inArray(reviewQueue.status, [ReviewQueueStatus.Queued, ReviewQueueStatus.Claimed]),
        ),
      )
      .returning({ id: reviewQueue.id });
    if (updated.length === 0) {
      throw new QueueStateError(queueId, 'QUEUED | CLAIMED', row.status);
    }

    // Record the drop as a DEFERRED decision so the rationale is auditable.
    await this.db.insert(decisions).values({
      id: newDecisionID(),
      change_id: brand(row.change_id, 'ChangeID'),
      assessment_id: brand(row.assessment_id, 'AssessmentID'),
      decision: HumanDecisionType.Deferred,
      reviewer_id: input.reviewerId,
      rationale: input.rationale,
    });
  }

  private async mustGetRow(queueId: ReviewQueueItemID): Promise<QueueRow> {
    const rows = await this.db
      .select(QUEUE_COLUMNS)
      .from(reviewQueue)
      .innerJoin(assessments, eq(assessments.id, reviewQueue.assessment_id))
      .where(eq(reviewQueue.id, queueId))
      .limit(1);
    const row = rows[0] as QueueRow | undefined;
    if (!row) {
      throw new QueueItemNotFoundError(queueId);
    }
    return row;
  }
}

/** Map a queue+assessment join row onto the public read model. */
function toQueueItem(row: QueueRow): QueueItem {
  return {
    id: brand(row.id, 'ReviewQueueItemID'),
    taskId: brand(row.task_id, 'TaskID'),
    assessmentId: brand(row.assessment_id, 'AssessmentID'),
    changeId: brand(row.change_id, 'ChangeID'),
    action: row.action,
    position: row.position,
    status: row.status,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
  };
}
