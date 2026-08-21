/**
 * Review backend types + seams (day-22 §2, day-23 §2).
 *
 * The review package is an engine under boundary rule R6: it imports only SHARED
 * packages (`@harness/domain`, `@harness/event-bus`, `@harness/db`) and itself.
 * The three cross-engine dependencies — driving the task state machine, feeding
 * the Day-19 alert-fatigue loop, and computing Day-17 diffs — are declared as
 * narrow structural seams below and injected by the composition root, exactly
 * like AgentRunner's `TaskTransitionService` (day-12 §2.4).
 */

import type {
  AssessmentID,
  ChangeID,
  EvidenceID,
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

/** One file's Day-17 unified diff (shape mirrors artifact-tracker's `FileDiff`). */
export interface ReviewFileDiff {
  readonly path: string;
  readonly hunks: string;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly isNewFile: boolean;
}

/** The structural seam onto the Day-17 diff engine (injected; R6). */
export interface DiffProvider {
  diffChange(changeId: ChangeID): Promise<ReviewFileDiff[]>;
}

/** The five Phase-1 attention factors (day-18 §2). */
export type ReviewFactorKey = 'risk' | 'impact' | 'novelty' | 'complexity' | 'confidence';

/** One factor's score plus whether it was backed by evidence (day-23 §2.3). */
export interface FactorScore {
  readonly key: ReviewFactorKey;
  readonly score: number;
  /** False when the factor was defaulted to 0.5 for missing evidence. */
  readonly available: boolean;
}

/** One verification check result, read-only, with its evidence link (day-23 §2.3). */
export interface VerificationCheckView {
  readonly kind: string;
  readonly status: string;
  readonly evidenceId: string | null;
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

/** The queue-columns a list row carries (day-23 §2.2: label, score, flaky). */
export interface QueueListItem extends QueueItem {
  readonly label: string;
  readonly combinedPriority: number;
  readonly taskTitle: string;
  readonly flaky: boolean;
  readonly ruleId: string;
  readonly policyVersion: number;
}

/** The composed detail payload (day-22 §2.4 + day-23 §2.3): assessment + task + decision. */
export interface QueueItemDetail extends QueueItem {
  readonly label: string;
  readonly combinedPriority: number;
  readonly ruleId: string;
  readonly policyVersion: number;
  readonly taskTitle: string;
  readonly taskState: string;
  /** The five factors, in order, each with its availability flag. */
  readonly factors: readonly FactorScore[];
  /** Per-check verification results with evidence links. */
  readonly checks: readonly VerificationCheckView[];
  /** The change's diffs (empty when the diff seam is absent). */
  readonly diffs: readonly ReviewFileDiff[];
  readonly decision: {
    readonly decision: HumanDecisionType;
    readonly reviewerId: ReviewerID;
    readonly rationale: string | null;
    readonly at: Date;
  } | null;
}

/** An evidence body, lazily loaded for the evidence modal (day-23 §2.3). */
export interface EvidenceRecord {
  readonly id: EvidenceID;
  readonly kind: string;
  readonly body: string;
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

/** The evidence id does not resolve to a body. */
export class EvidenceNotFoundError extends ReviewError {
  constructor(readonly evidenceId: EvidenceID) {
    super(`evidence ${evidenceId} not found`);
  }
}
