/**
 * Identity model (Phase 2 day-01 §2.1).
 *
 * Identity is keyed on the **provider-stable OIDC `sub`**, never on an email —
 * emails get re-assigned and renamed; the `sub` is what an identity provider
 * guarantees is stable. Internal rows (`decisions.actor_id`, `event_log.actor_id`)
 * foreign-key to `User.id`, a UUIDv7, so re-provisioning a user never rewrites
 * history. `email`/`displayName` are display data and are allowed to change.
 */

import type { SessionID, UserID } from './ids.js';

/** Privilege levels. Rules are additive: ADMIN ⊇ REVIEWER ⊇ OPERATOR (day-02 §2.1). */
export const Role = {
  Operate: 'OPERATOR',
  Reviewer: 'REVIEWER',
  Admin: 'ADMIN',
} as const;
/** A user's privilege role. */
export type Role = (typeof Role)[keyof typeof Role];

/** The set of roles every Phase-2 actor starts with on first sight. */
export const DEFAULT_ROLES: readonly Role[] = [Role.Operate];

/**
 * A registered user. `oidcSub` is the uniqueness anchor; `id` is what other
 * rows reference.
 */
export interface User {
  readonly id: UserID;
  readonly oidcSub: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly Role[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Raw `userinfo`/id_token claims an OIDC provider returns (day-01 §2.3). */
export interface OidcUserInfo {
  readonly sub: string;
  readonly email: string;
  readonly name?: string;
}

/**
 * A revocable browser/app session (day-01 §2.2). The JWT answers "who is this?"
 * statelessly; the `sessions` row answers "is that identity still *revocable*?" —
 * a leaked signed token is dead the moment its session is revoked.
 */
export interface Session {
  readonly id: SessionID;
  readonly userId: UserID;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/** The authenticated principal handed to request handlers (day-02 enforcement). */
export interface AuthContext {
  readonly user: User;
  readonly sid: SessionID;
  readonly roles: readonly Role[];
}
