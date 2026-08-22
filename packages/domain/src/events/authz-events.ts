/**
 * Authorization event payloads (day-02 §2.3 — a denied attempt is itself
 * evidence, not a silent 403).
 */

import type { UserID } from '../ids.js';

/**
 * Payload for {@link import('./event-types.js').EventType.AuthzDecisionDenied}.
 *
 * Emitted by `requireRole` every time an authenticated-but-insufficiently-
 * privileged actor is refused, so `authz.decision_denied` is queryable from the
 * event log — the anchor for the Week-2 "who can't do what" report.
 */
export interface DecisionDeniedPayload {
  /** The authenticated principal who was refused. */
  readonly actor_id: UserID;
  /** The resource being guarded, e.g. the request path. */
  readonly resource: string;
  /** The roles the action requires; the actor had none of them. */
  readonly roles_required: readonly string[];
}
