/**
 * Ground-truth labeling rules (day-06 §2.1).
 *
 * The distinction that makes these honest: the labels come from the **outcome** —
 * the decision made on a change and any later rework/defect — never from the
 * Attention Engine's own scoring output. Precision measured as "the engine said HIGH
 * and a human looked" is circular and tells you nothing; reject/rework/defect is
 * evidence from outside the scoring path.
 */

import type { ReworkRow } from './report.js';

/** Task states that mean "this change needed attention we should have caught". */
const DEFECT_STATES: ReadonlySet<string> = new Set(['REWORK', 'AWAITING_HUMAN_INTERVENTION']);

/** Human decisions that are themselves evidence the change warranted review. */
const REJECTION_DECISIONS: ReadonlySet<string> = new Set(['REJECTED', 'REQUEST_CHANGES']);

/** A route went to a human unless it was auto-approvable (day-04 route mapping). */
export function isHumanRoute(action: string): boolean {
  return action !== 'AUTO_APPROVABLE';
}

/** Did the human reject (or request changes on) this change? */
export function isRejection(decision: string): boolean {
  return REJECTION_DECISIONS.has(decision);
}

/** Did this task later re-enter a defect state *after* the route timestamp? */
export function hasLaterDefect(
  taskId: string,
  after: Date,
  reworkLog: readonly ReworkRow[],
): boolean {
  const afterMs = after.getTime();
  for (const rework of reworkLog) {
    if (
      rework.taskId === taskId &&
      DEFECT_STATES.has(rework.toState) &&
      rework.occurredAt.getTime() >= afterMs
    ) {
      return true;
    }
  }
  return false;
}
