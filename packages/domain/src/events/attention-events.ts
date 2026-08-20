/**
 * Attention assessment event payloads (attention spec §2.1).
 */

import type { ArtifactID, AssessmentID } from '../ids.js';
import type { PriorityLabel } from '../attention.js';

/** Payload for {@link import('./event-types.js').EventType.AssessmentCreated}. */
export interface AssessmentCreatedPayload {
  /** The new attention assessment. */
  readonly assessment_id: AssessmentID;
  /** The artifact the assessment covers. */
  readonly artifact_id: ArtifactID;
  /** Combined priority in `[0, 1]`. */
  readonly combined_priority: number;
  /** The derived priority label. */
  readonly label: PriorityLabel;
}
