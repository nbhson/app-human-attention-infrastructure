/**
 * Review backend types + seams (day-22 §2).
 *
 * The review package is an engine under boundary rule R6: it imports only SHARED
 * packages (`@harness/domain`, `@harness/event-bus`, `@harness/db`) and itself.
 * The two cross-engine dependencies — driving the task state machine and feeding
 * the Day-19 alert-fatigue loop — are declared as narrow structural seams below
 * and injected by the composition root, exactly like AgentRunner's
 * `TaskTransitionService` (day-12 §2.4).
 */

import type {
  AssessmentID,
  ChangeID,
  HumanDecisionType,
  ReviewerID,
  ReviewQueueItemID,
  TaskID,
  TaskStatus,
  TaskTrigger,
} from '@harness/domain';

/** The two reviewer decisions accepted by the Phase-1 API (day-22 §2.1). */
export type DecisionChoice = 'APPROVE' | 'REJECT';

/** A submitted decision (day-22 §2.1). */
export interface DecisionInput {
  readonly decision: DecisionChoice;
  /** Required rationale — AWAITING_REVIEW → APPROVED/REJECTED is human-driven. */
  readonly rationale: string;
  /** Feeds the Day-19 alert-fatigue loop (was this worth the attention?). */
  readonly wasUseful: boolean;
  readonly comment?: string;
  readonly reviewerId: ReviewerID;
}

/** A dropped queue item's required input (day-22 §2.1 — never silent). */
export interface DropInput {
  readonly rationale: string;
  readonly reviewerId: ReviewerID;
}

/** The structural seam onto the task state machine (injected; R6). */
export interface TaskTransition {
  transitionTask(
    taskId: TaskID,
    toState: TaskStatus,
    triggeredBy: TaskTrigger,
    opts?: { readonly rationale?: string; readonly expectedFrom?: TaskStatus },
  ): Promise<unknown>;
}

/** The structural seam onto the attention feedback loop (injected; R6). */
export interface FeedbackReporter {
  reportAssessmentFeedback(
    assessmentId: AssessmentID,
    wasUseful: boolean,
    comment?: string,
  ): Promise<void>;
}

/** A queue entry as read by the list/detail end-points. */
export interface QueueItem {
  readonly id: ReviewQueueItemID;
  readonly taskId: TaskID;
  readonly assessmentId: AssessmentID;
  readonly changeId: ChangeID;
  readonly action: string;
  readonly position: number;
  readonly status: string;
  readonly claimedBy: string | null;
  readonly claimedAt: Date | null;
  readonly createdAt: Date;
}

/** The composed detail payload (day-22 §2.4): assessment + task + decision. */
export interface QueueItemDetail extends QueueItem {
  readonly label: string;
  readonly combinedPriority: number;
  readonly ruleId: string;
  readonly policyVersion: number;
  readonly taskTitle: string;
  readonly taskState: string;
  readonly decision: {
    readonly decision: HumanDecisionType;
    readonly reviewerId: ReviewerID;
    readonly rationale: string | null;
    readonly at: Date;
  } | null;
}

/** Base class for all review-API failures (mapped to HTTP status by the routes). */
export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Two reviewers claimed the same item; the loser gets a 409 (day-22 §2.2). */
export class QueueConflictError extends ReviewError {
  constructor(readonly queueId: ReviewQueueItemID) {
    super(`review queue item ${queueId} is no longer claimable`);
  }
}

/** A decide (or drop) on an item that is not in the required status. */
export class QueueStateError extends ReviewError {
  constructor(
    readonly queueId: ReviewQueueItemID,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`review queue item ${queueId}: expected ${expected}, got ${actual}`);
  }
}

/** The item does not exist. */
export class QueueItemNotFoundError extends ReviewError {
  constructor(readonly queueId: ReviewQueueItemID) {
    super(`review queue item ${queueId} not found`);
  }
}

/** A human-driven action (drop) was submitted without a rationale. */
export class MissingRationaleError extends ReviewError {
  constructor() {
    super('a rationale is required');
  }
}
