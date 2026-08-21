/**
 * Attention assessment event payloads (attention spec §2.1, §4).
 */

import type { AssessmentID, ArtifactID, ReviewQueueItemID, TaskID } from '../ids.js';
import type { PriorityLabel, RoutingAction } from '../attention.js';

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
  /** Which label band's threshold moved. */
  readonly label: PriorityLabel;
  /** Previous threshold value. */
  readonly from: number;
  /** New threshold value. */
  readonly to: number;
}

/** Payload for {@link import('./event-types.js').EventType.AttentionInflationDetected}. */
export interface AttentionInflationDetectedPayload {
  /** Mean-combined-priority ratio (this week / previous week). */
  readonly ratio: number;
  /** The configured alert threshold the ratio exceeded. */
  readonly alert_ratio: number;
  /** Window size in days per bucket. */
  readonly window_days: number;
}
