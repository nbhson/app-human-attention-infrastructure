/**
 * Shared types for the review routes.
 *
 * Kept in one place so `review.ts` (queue decisions) and `reviews.ts`
 * (ingest + PR decisions) stay in sync; callers destructure the body the same
 * way regardless of which route path they hit.
 */

/** Body shape for the human review decision (queue flow — requires rationale). */
export interface QueueDecideBody {
  readonly decision: 'APPROVE' | 'REJECT';
  readonly rationale: string;
  readonly wasUseful: boolean;
  readonly comment?: string;
}

/** Body shape for the ingest-side review decision (PR write-back flow). */
export interface ReviewDecideBody {
  readonly decision?: string;
  readonly rationale?: string;
  /** When true, write a review comment back to the PR (behind the write-back toggle). */
  readonly writeback?: boolean;
  /** Optional comment text for the write-back; defaults to a decision summary. */
  readonly comment?: string;
}

/** Body shape for dropping / releasing a queue item. */
export interface RationaleBody {
  readonly rationale: string;
}
