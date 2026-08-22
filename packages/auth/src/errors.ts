/**
 * Auth package error types (day-01 §2).
 *
 * Each maps to a distinct failure the HTTP layer must translate: unauthenticated
 * requests (no/invalid evidence of identity) are **401**, while an authenticated
 * but insufficiently-privileged actor is a **403** (`ForbiddenError`, added Day 02).
 */

/** Base class for all auth failures. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** No usable credential was presented (missing cookie/JWT), or it must be treated as absent. */
export class UnauthenticatedError extends AuthError {
  constructor() {
    super('authentication required');
  }
}

/** A token was presented but is not valid (bad signature, malformed, or expired). */
export class InvalidTokenError extends AuthError {
  constructor(message = 'invalid or expired token') {
    super(message);
  }
}

/** The token is well-formed but its session has been revoked (logout / compromise). */
export class SessionRevokedError extends AuthError {
  constructor() {
    super('session has been revoked');
  }
}

/** Authenticated but lacking a required role. Carries the actor for the audit event. */
export class ForbiddenError extends AuthError {
  constructor(
    readonly userId: string,
    readonly requiredRoles: readonly string[],
  ) {
    super('insufficient role for this action');
  }
}
