/**
 * The write-back audit + idempotency port (review-reorient Phase 3 day-08).
 *
 * The {@link WritebackLogStore} is the seam through which the write-back service
 * records every external write attempt before it happens and updates the outcome
 * after it returns. It lives here (in `@harness/domain`, the shared contract)
 * rather than in `@harness/writeback` or `@harness/db` because the two are
 * boundary-forbidden from importing each other: the service consumes the port,
 * and the Drizzle store in `@harness/db` implements it, and both import the type
 * from the middle. `@harness/domain` is the one package both may depend on.
 *
 * Idempotency is a *claim-then-write*: `claim()` atomically decides whether this
 * attempt may proceed (no identical `SUCCEEDED` write exists) and records a row —
 * `PENDING` when it may, `DUPLICATE` when it may not. `finalize()` moves a claimed
 * row to `SUCCEEDED`/`FAILED`; a concurrent duplicate that races to the same
 * terminal state is caught by the store's unique partial index and degrades to
 * `DUPLICATE` (day-08 §2.2).
 */

import type { WritebackAction } from './integration.js';
import type { WriteBackProvider } from './writeback.js';

/** The fields needed to claim (and audit) one write-back attempt. */
export interface WritebackClaim {
  /** The intent id; doubles as the write-back row's primary key. */
  readonly intentId: string;
  readonly provider: WriteBackProvider;
  readonly externalId: string;
  readonly action: WritebackAction;
  /** The payload written (already normalized for the dedup fingerprint). */
  readonly body: string;
  /** The deterministic idempotency fingerprint. */
  readonly dedupKey: string;
}

/** The idempotency verdict of a {@link WritebackLogStore.claim}. */
export type WritebackClaimOutcome = 'claimed' | 'duplicate';

/** The request to set a claimed write's terminal outcome. */
export interface WritebackFinalize {
  /** The intent id of the claim to close. */
  readonly intentId: string;
  /** The winner's terminal state (`SUCCEEDED` or `FAILED`). */
  readonly status: 'SUCCEEDED' | 'FAILED';
  /** Host handle for the written thing (SUCCEEDED only). */
  readonly externalRef?: string;
  /** Redacted error (FAILED only). */
  readonly error?: string;
}

/** The write-back audit + idempotency store (day-08). */
export interface WritebackLogStore {
  /**
   * Atomically claim the dedup key: return `'duplicate'` (and record a `DUPLICATE`
   * row) when an identical `SUCCEEDED` write already exists, else record a
   * `PENDING` row and return `'claimed'` so the caller proceeds to write.
   */
  claim(input: WritebackClaim): Promise<WritebackClaimOutcome>;
  /**
   * Close a claimed write. A `SUCCEEDED` finalize races the unique partial index:
   * a losing concurrent duplicate degrades to `DUPLICATE` rather than throwing.
   */
  finalize(input: WritebackFinalize): Promise<void>;
}
