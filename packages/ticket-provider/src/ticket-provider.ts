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

/** The narrow ticket-system surface the review slice depends on. */
export interface TicketProvider {
  /** The system this provider talks to. */
  readonly type: TicketProviderType;

  /** Fetch the issue metadata + description. */
  fetchIssue(input: FetchIssueInput): Promise<Issue>;
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
