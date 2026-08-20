/**
 * Human review decision event payloads (architecture spec §13).
 */

import type { ChangeID, DecisionID, ReviewerID } from '../ids.js';
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
}
