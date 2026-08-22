/**
 * Auto-approve sampling audit (day-14 §2.3) — a silent control, not a brown M&M.
 *
 * On each auto-approve, with probability `audit_sample_rate`, the sampler also
 * routes the item to a human reviewer *without telling them it was auto-approved*
 * (the `sampled` marker lives only on the backend row, never in the UI payload).
 * When that control reviewer rejects the item, the sampler emits
 * `evaluation.escalation_leakage` — Spec 11 §4.1's "auto-approvable-but-rejected"
 * — so an over-confident auto-approve is measured, not silently absorbed.
 */

import { and, desc, eq } from 'drizzle-orm';

import { assessments, reviewQueue } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import {
  brand,
  EventType,
  HumanDecisionType,
  newCorrelationID,
  newReviewQueueItemID,
  ReviewQueueStatus,
} from '@harness/domain';
import type {
  AssessmentID,
  ChangeID,
  DecisionSubmittedPayload,
  ReviewQueueItemID,
  TaskID,
} from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

/** The queue row the sampler duplicates when a control is selected. */
export interface SampledControlInput {
  readonly taskId: TaskID;
  readonly assessmentId: AssessmentID;
  readonly changeId: ChangeID;
  /** The policy version that produced the auto-approve (explainability). */
  readonly policyVersion: number;
}

export class AutoApproveSampler {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly logger?: Logger,
  ) {}

  /**
   * Probability router for the sample rate. `random` is injectable so tests hold
   * the outcome deterministic; the default is `Math.random`.
   */
  shouldSample(rate: number, random: () => number = Math.random): boolean {
    return random() < rate;
  }

  /** Subscribe to human rejections; a rejected *sampled* control emits leakage. */
  subscribe(): void {
    this.bus.subscribe<DecisionSubmittedPayload>(EventType.DecisionSubmitted, (event) => {
      if (event.payload.decision !== HumanDecisionType.Rejected) {
        return;
      }
      void this.onRejected(event.payload).catch((error) => {
        this.logger?.error('auto-approve: leakage check failed', {
          correlation_id: event.correlation_id,
          change_id: event.payload.change_id,
          error: String(error),
        });
      });
    });
  }

  /**
   * Route a silent control to the human queue. A second, `sampled`-flagged row
   * with `action = REVIEW_REQUIRED` forces a human to look at it (the original
   * `AUTO_APPROVABLE` row was already decided by the machine).
   */
  async routeToHuman(input: SampledControlInput): Promise<ReviewQueueItemID> {
    const queueId = newReviewQueueItemID();
    const position = await this.nextPosition();
    await this.db.insert(reviewQueue).values({
      id: queueId,
      task_id: input.taskId,
      assessment_id: input.assessmentId,
      action: 'REVIEW_REQUIRED',
      policy_version: input.policyVersion,
      rule_id: 'sampled-control',
      position,
      status: ReviewQueueStatus.Queued,
      sampled: true,
    });
    return queueId;
  }

  /**
   * A human rejected a decision; if it was a sampled control for this change,
   * publish `evaluation.escalation_leakage`. Correlates the *control* (not the
   * original auto-approve) to the change via `review_queue.sampled`.
   */
  async onRejected(payload: DecisionSubmittedPayload): Promise<void> {
    const rows = await this.db
      .select({ assessmentId: reviewQueue.assessment_id })
      .from(reviewQueue)
      .innerJoin(assessments, eq(assessments.id, reviewQueue.assessment_id))
      .where(and(eq(assessments.change_id, payload.change_id), eq(reviewQueue.sampled, true)))
      .limit(1);
    if (rows.length === 0) {
      return;
    }

    this.bus.publish(
      createEvent(EventType.EscalationLeakage, newCorrelationID(), {
        change_id: payload.change_id,
        assessment_id: brand(rows[0]!.assessmentId, 'AssessmentID'),
        decision: payload.decision,
        sample: true,
      }),
    );
  }

  /** FIFO position: one past the current maximum. */
  private async nextPosition(): Promise<number> {
    const rows = await this.db
      .select({ position: reviewQueue.position })
      .from(reviewQueue)
      .orderBy(desc(reviewQueue.position))
      .limit(1);
    return (rows[0]?.position ?? 0) + 1;
  }
}
