/**
 * Attention assessment event payloads (attention spec §2.1, §4).
 */

import type { AssessmentID, ArtifactID, ReviewQueueItemID, TaskID } from '../ids.js';
import type { PriorityLabel, RoutingAction, ThresholdBand } from '../attention.js';

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

/** Payload for {@link import('./event-types.js').EventType.AttentionItemRouted}. */
export interface AttentionItemRoutedPayload {
  /** The review-queue entry this routing produced. */
  readonly queue_id: ReviewQueueItemID;
  /** The assessment that was routed. */
  readonly assessment_id: AssessmentID;
  /** The task the assessment covers. */
  readonly task_id: TaskID;
  /** The routing decision. */
  readonly action: RoutingAction;
  /** Policy version that produced the decision (explainability). */
  readonly policy_version: number;
  /** The matched rule id (explainability). */
  readonly rule_id: string;
  /** True when the item was budget-deferred (still QUEUED, flagged for later). */
  readonly deferred: boolean;
}

/** Payload for {@link import('./event-types.js').EventType.AttentionThresholdAdjusted}. */
export interface AttentionThresholdAdjustedPayload {
  /** Which label band's threshold moved (HIGH | CRITICAL). */
  readonly band: ThresholdBand;
  /** Previous threshold value. */
  readonly before: number;
  /** New threshold value. */
  readonly after: number;
  /** The observed condition that drove the move, e.g. `approval_rate 0.97 > 0.95`. */
  readonly reason: string;
}

/** Payload for {@link import('./event-types.js').EventType.AttentionInflationDetected}. */
export interface AttentionInflationDetectedPayload {
  /** CRITICAL+HIGH share of recent assessments over the window. */
  readonly share: number;
  /** The configured ceiling the share exceeded. */
  readonly ceiling: number;
  /** Window size in days. */
  readonly window_days: number;
}

/** Payload for {@link import('./event-types.js').EventType.AttentionItemDeferred}. */
export interface AttentionItemDeferredPayload {
  /** The review-queue entry that was deferred (still QUEUED, flagged). */
  readonly queue_id: ReviewQueueItemID;
  /** The assessment that was deferred. */
  readonly assessment_id: AssessmentID;
  /** The task the assessment covers. */
  readonly task_id: TaskID;
  /** UTC timestamp the item is deferred until (next day boundary). */
  readonly deferred_until: string;
}
