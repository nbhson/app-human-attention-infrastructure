/**
 * Human review decision types.
 *
 * Human decisions are first-class domain events (architecture spec §13) — they
 * are valuable system knowledge, not just UI interaction. This module defines
 * the decision vocabulary and the review queue item the Human Review Interface
 * consumes.
 */

import type { AssessmentID, ChangeID, DecisionID, EvidenceID, ReviewerID, TaskID } from './ids.js';
import type { PriorityLabel, SuggestReviewDepth } from './attention.js';

/**
 * The possible human decisions (architecture spec §13).
 */
export const HumanDecisionType = {
  Approved: 'APPROVED',
  Rejected: 'REJECTED',
  RequestChanges: 'REQUEST_CHANGES',
  Overridden: 'OVERRIDDEN',
  Deferred: 'DEFERRED',
  Escalated: 'ESCALATED',
} as const;
/** A human decision type. */
export type HumanDecisionType = (typeof HumanDecisionType)[keyof typeof HumanDecisionType];

/**
 * A recorded human decision (architecture spec §13).
 */
export interface HumanDecision {
  /** Unique decision id. */
  readonly id: DecisionID;
  /** The reviewer who made the decision. */
  readonly reviewerId: ReviewerID;
  /** When the decision was made. */
  readonly timestamp: Date;
  /** The task the decision targets. */
  readonly targetTaskId: TaskID;
  /** The change the decision targets, if any. */
  readonly targetChangeId?: ChangeID;
  /** The decision. */
  readonly decision: HumanDecisionType;
  /** The reason given. */
  readonly reason: string;
  /** Evidence the reviewer viewed before deciding. */
  readonly evidenceViewed: EvidenceID[];
  /** Optional structured result (e.g. requested changes summary). */
  readonly result?: string;
  /** Free-form extension metadata. */
  readonly metadata: Record<string, unknown>;
}

/** The state of a review-queue item (Human Review Interface). */
export const ReviewQueueItemStatus = {
  Pending: 'PENDING',
  InProgress: 'IN_PROGRESS',
  Resolved: 'RESOLVED',
} as const;
/** A review-queue item status. */
export type ReviewQueueItemStatus =
  (typeof ReviewQueueItemStatus)[keyof typeof ReviewQueueItemStatus];

/**
 * The persistence-level state of a `review_queue` row (attention spec §4). This
 * is the lifecycle the routing engine and the review API drive — distinct from
 * the presentation-facing {@link ReviewQueueItemStatus} above.
 */
export const ReviewQueueStatus = {
  Queued: 'QUEUED',
  Claimed: 'CLAIMED',
  Decided: 'DECIDED',
  Dropped: 'DROPPED',
} as const;
/** A persistence-level review-queue status. */
export type ReviewQueueStatus = (typeof ReviewQueueStatus)[keyof typeof ReviewQueueStatus];

/**
 * An entry in the human review queue.
 *
 * This is a presentation-facing read-model assembled from an
 * {@link AttentionAssessment}; it has no upstream spec section of its own, so it
 * is kept deliberately minimal.
 */
export interface ReviewQueueItem {
  /** The task awaiting review. */
  readonly taskId: TaskID;
  /** The change awaiting review. */
  readonly changeId: ChangeID;
  /** The attention assessment driving this queue entry. */
  readonly assessmentId: AssessmentID;
  /** The derived priority label. */
  readonly priorityLabel: PriorityLabel;
  /** The suggested review depth. */
  readonly suggestedReviewDepth: SuggestReviewDepth;
  /** When the item entered the queue. */
  readonly requestedAt: Date;
  /** Current queue state. */
  readonly status: ReviewQueueItemStatus;
  /** Optional reviewer assigned. */
  readonly reviewerId?: ReviewerID;
}

/** Input for {@link createHumanDecision}. */
export type CreateHumanDecisionInput = Omit<
  HumanDecision,
  'timestamp' | 'metadata' | 'evidenceViewed'
> &
  Partial<
    Pick<HumanDecision, 'timestamp' | 'metadata' | 'evidenceViewed' | 'targetChangeId' | 'result'>
  >;

/**
 * Build a {@link HumanDecision} defaulting `timestamp` to now and
 * `evidenceViewed`/`metadata` to empty.
 */
export function createHumanDecision(input: CreateHumanDecisionInput): HumanDecision {
  return { timestamp: new Date(), evidenceViewed: [], metadata: {}, ...input };
}

/**
 * Build a {@link ReviewQueueItem} defaulting `status` to `PENDING`.
 */
export function createReviewQueueItem(
  input: Omit<ReviewQueueItem, 'status'> & Partial<Pick<ReviewQueueItem, 'status'>>,
): ReviewQueueItem {
  return { status: ReviewQueueItemStatus.Pending, ...input };
}
