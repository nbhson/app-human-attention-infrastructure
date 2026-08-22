/**
 * The review state machine (day-24 §2.2) — the finite graph of legal
 * transitions over a `review_queue` row, now a written-down contract instead of
 * folklore.
 *
 * The graph is normative (Spec 8 §2.2), so an unstated transition can't surprise
 * the next engineer. Each action lists exactly the `from` states that may take
 * it; any other pairing is an {@link IllegalTransitionError} — *thrown*, not
 * logged. Two transitions that never existed before Day 24 are now first-class:
 *
 * - `release` — a claimed item whose claim times out returns to `QUEUED` with its
 *   claim released (never silently orphaned in `CLAIMED`).
 * - `escalate` — a reviewer who can't decide hands the item to a higher authority,
 *   landing in `ESCALATED` with a recorded `ESCALATED` decision.
 *
 * `claim` is deliberately *not* a read-then-assert: claiming is an acquire, and
 * its `QUEUED → CLAIMED` edge is enforced by the service's atomic guarded UPDATE
 * (optimistic concurrency), where a losing racer surfaces as `QueueConflictError`.
 * The remaining actions read the row and assert against this table.
 */

import { ReviewQueueStatus } from '@harness/domain';
import type { ReviewQueueStatus as ReviewQueueState } from '@harness/domain';

/** A mutating user action on the review surface (Spec 8 §2.4). */
export type ReviewAction = 'claim' | 'decide' | 'release' | 'escalate' | 'drop';

/** For each action, the set of persistence states it may legally start from. */
export const ALLOWED_FROM: Readonly<Record<ReviewAction, ReadonlySet<ReviewQueueState>>> = {
  claim: new Set([ReviewQueueStatus.Queued]),
  decide: new Set([ReviewQueueStatus.Claimed]),
  release: new Set([ReviewQueueStatus.Claimed]),
  escalate: new Set([ReviewQueueStatus.Claimed]),
  drop: new Set([ReviewQueueStatus.Queued, ReviewQueueStatus.Claimed]),
};

/** Whether `action` may be taken while the item is in state `from`. */
export function canTransition(from: string, action: ReviewAction): boolean {
  return ALLOWED_FROM[action].has(from as ReviewQueueState);
}

/** Thrown when an action is attempted on a state that disallows it (§2.2). */
export class IllegalTransitionError extends Error {
  override readonly name = 'IllegalTransitionError';

  constructor(
    readonly from: string,
    readonly action: ReviewAction,
  ) {
    super(`illegal review transition: cannot ${action} from ${from}`);
  }
}

/** Enforce the finite graph: throw {@link IllegalTransitionError} on a bad move. */
export function assertTransition(from: string, action: ReviewAction): void {
  if (!canTransition(from, action)) {
    throw new IllegalTransitionError(from, action);
  }
}
