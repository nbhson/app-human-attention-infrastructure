/**
 * Review-flow decision types (review-reorient Phase 3 day-09).
 *
 * Distinct from the Phase-1 {@link HumanDecisionType} (`APPROVED` / `REJECTED` /
 * `REQUEST_CHANGES` / …) and the AI's recommended {@link ReviewVerdict}
 * (`APPROVE` / `REQUEST_CHANGES` / `COMMENT`): this is the *human's recorded
 * verdict on a Phase-3 {@link ReviewReport}, and it carries the write-back toggle
 * so an audit can reconstruct why nothing external was written on a given
 * decision (day-09 §1 goal 3).
 */

import { newDecisionID } from './ids.js';
import type { DecisionID, ReviewReportID } from './ids.js';

/** The three verdicts a human records on a review report (day-09 §2.2). */
export const ReviewDecisionType = {
  Approve: 'APPROVE',
  RequestChanges: 'REQUEST_CHANGES',
  Reject: 'REJECT',
} as const;
/** A recorded review-decision verdict. */
export type ReviewDecisionType = (typeof ReviewDecisionType)[keyof typeof ReviewDecisionType];

/**
 * A recorded review decision (day-09). One row per human verdict on a report.
 *
 * `writebackEnabled` is the *effective* write-back gate at decision time
 * (`WRITEBACK_ENABLED` env ceiling AND the request-level flag); it is stored even
 * when OFF so "nothing was written" is an auditable fact, not an absence.
 */
export interface ReviewDecision {
  /** Unique decision id. */
  readonly id: DecisionID;
  /** The review report this decision targets. */
  readonly reportId: ReviewReportID;
  readonly decision: ReviewDecisionType;
  /** The human's rationale, if given. */
  readonly rationale?: string;
  /** Effective write-back gate at decision time (env ceiling AND request flag). */
  readonly writebackEnabled: boolean;
  readonly createdAt: Date;
}

/** Input for {@link createReviewDecision}. */
export type CreateReviewDecisionInput = Omit<ReviewDecision, 'id' | 'createdAt'> &
  Partial<Pick<ReviewDecision, 'id' | 'createdAt'>>;

/** Build a {@link ReviewDecision}, defaulting `id` to a fresh UUIDv7 and `createdAt` to now. */
export function createReviewDecision(input: CreateReviewDecisionInput): ReviewDecision {
  return { id: newDecisionID(), createdAt: new Date(), ...input };
}
