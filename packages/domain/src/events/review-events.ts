/**
 * Human review decision event payloads (architecture spec §13).
 */

import type { ChangeID, DecisionID, ReviewerID, UserID } from '../ids.js';
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
