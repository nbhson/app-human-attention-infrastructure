/**
 * The write-back *command* contract (review-reorient Phase 3 day-06).
 *
 * `WriteBackIntent` is the request the review-decision path emits; it is
 * deliberately incapable of expressing a code change — there is no `code`,
 * `commit`, or `diff` slot, and adding one is a visible, reviewable type change
 * (day-06 §2.2, §6). The *outcome* of a write-back is the existing
 * {@link WritebackEntry} (`writeback_log` row) recorded by the Day-08 audit
 * layer; the intent + {@link WriteBackResult} here only carry the request across
 * the `@harness/writeback` seam and back.
 */

import type { GitProviderType, TicketProviderType, WritebackAction } from './integration.js';

/** A provider the write-back seam can post to: a Git host or a ticket system. */
export type WriteBackProvider = GitProviderType | TicketProviderType;

/** A Git-host commit status (mirrors `GitProvider.setStatus`'s union). */
export type WriteBackState = 'pending' | 'success' | 'failure';

/**
 * One write-back request. `provider` + `externalId` (+ `repo` on a Git host)
 * identify the target; `action` names a commentary/status transition — never
 * code.
 */
export interface WriteBackIntent {
  readonly id: string;
  readonly provider: WriteBackProvider;
  /** PR/MR number (Git hosts) or issue key (Jira). */
  readonly externalId: string;
  readonly action: WritebackAction;
  /** Comment text / status description / transition audit note. */
  readonly body?: string;
  /** For `status` only. */
  readonly state?: WriteBackState;
  /** For `label` only. */
  readonly label?: string;
  /** For `transition` (Jira) only — the target status name. */
  readonly toState?: string;
  /**
   * `host/owner/name` repo slug — required for Git-host write-back so the
   * service can build the host's tool arguments; ignored for ticket systems.
   */
  readonly repo?: string;
}

/**
 * The outcome of one write-back attempt. `ok` is false on a *write* failure (a
 * tool returning `isError`, a transport error) — the recordable FAILED outcome.
 * An *invalid* intent (an unsupported action for the provider, a missing repo,
 * an unknown provider) throws a `WriteBackError` instead: it is a programming
 * error to fix, not an external failure to log. A disabled toggle is a
 * successful no-op (an `ok: true` result with no `externalRef`), never a
 * failure — nothing external was tried.
 */
export interface WriteBackResult {
  readonly ok: boolean;
  readonly intentId: string;
  /** The host's handle for the written comment/status/label/transition. */
  readonly externalRef?: string;
  /** The error message when `ok` is false. */
  readonly error?: string;
}
