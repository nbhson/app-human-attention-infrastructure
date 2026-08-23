/**
 * The `TicketProvider` seam (review-reorient Phase 3) — the *only* place the
 * harness reads a requirement from a ticket system (Jira first).
 *
 * A provider translates "fetch issue KEY" into a normalised {@link Issue} whose
 * description becomes the "requirements" input the AI reviewer weighs the PR
 * against. Depends only on `@harness/domain`.
 */

import type { Issue, TicketProviderType } from '@harness/domain';

/** Which issue to fetch, from a system the provider already knows how to reach. */
export interface FetchIssueInput {
  /** Host issue key, e.g. `ACME-1234`. */
  readonly key: string;
}

/**
 * The narrow ticket-system surface the review slice depends on.
 *
 * Unlike {@link GitProvider}, this seam keeps a single `type`: there is exactly
 * one ticket system today (Jira), so the read seam is not multi-host. The write
 * primitives below complete the contract for the Day-06 write-back week and are
 * expected to fail loudly until then.
 */
export interface TicketProvider {
  /** The system this provider talks to. */
  readonly type: TicketProviderType;

  /** Fetch the issue metadata + description. */
  fetchIssue(input: FetchIssueInput): Promise<Issue>;

  /** Post a comment to the issue (used by the optional write-back path). */
  postComment(input: FetchIssueInput, body: string): Promise<void>;

  /** Move the issue to a target status/state (used by the optional write-back path). */
  transition(input: FetchIssueInput, targetState: string): Promise<void>;
}

/** A ticket-system request failed for any reason (auth, network, not-found, rate-limit). */
export class TicketProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'TicketProviderError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
