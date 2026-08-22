/**
 * Human review decision event payloads (architecture spec §13).
 */

import type {
  ChangeID,
  DecisionID,
  ReviewerID,
  ReviewQueueItemID,
  TaskID,
  UserID,
} from '../ids.js';
import type { HumanDecisionType } from '../review.js';

/** Payload for {@link import('./event-types.js').EventType.DecisionSubmitted}. */
export interface DecisionSubmittedPayload {
  /** The recorded decision. */
  readonly decision_id: DecisionID;
  /** The change the decision targets. */
  readonly change_id: ChangeID;
  /** The decision made. */
  readonly decision: HumanDecisionType;
  /** The reviewer who decided. */
  readonly reviewer_id: ReviewerID;
  /**
   * The authenticated actor behind the decision (day-02 §3.4, event_version 2).
   * Additive — `reviewer_id` is kept so Phase-1 consumers don't break.
   */
  readonly actor_id: UserID;
}

/** Payload for {@link import('./event-types.js').EventType.ReviewItemClaimed}. */
export interface ReviewItemClaimedPayload {
  /** The queue item that moved QUEUED → CLAIMED. */
  readonly queue_id: ReviewQueueItemID;
  /** The task the item reviews. */
  readonly task_id: TaskID;
  /** The authenticating principal who claimed — also the dwell anchor (day-04 §2). */
  readonly reviewer_id: ReviewerID;
}

/** Payload for {@link import('./event-types.js').EventType.ReviewItemReleased}. */
export interface ReviewItemReleasedPayload {
  /** The queue item that moved CLAIMED → QUEUED (claim released / timed out). */
  readonly queue_id: ReviewQueueItemID;
  /** The task the item reviews. */
  readonly task_id: TaskID;
  /** The authenticated actor who released (or whose claim expired). */
  readonly actor_id: UserID;
}

/** Payload for {@link import('./event-types.js').EventType.ReviewItemEscalated}. */
export interface ReviewItemEscalatedPayload {
  /** The queue item that moved CLAIMED → ESCALATED. */
  readonly queue_id: ReviewQueueItemID;
  /** The recorded ESCALATED decision (auditable, joins to `decisions`). */
  readonly decision_id: DecisionID;
  /** The task the item reviews. */
  readonly task_id: TaskID;
  /** The authenticated actor who escalated. */
  readonly actor_id: UserID;
}
