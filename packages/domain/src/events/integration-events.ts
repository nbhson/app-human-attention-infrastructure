/**
 * Integration event payloads (review-reorient Phase 3).
 *
 * Payload shapes for the external-PR review slice. These live here (not in
 * `@harness/event-bus`) so the bus package has zero domain dependencies beyond
 * `@harness/domain` itself.
 */

import type { GitProviderType, TicketProviderType } from '../integration.js';
import type { FixSuggestionID, ReviewReportID, TaskID, WritebackID } from '../ids.js';

/** Payload for {@link import('./event-types.js').EventType.IntegrationPrFetched}. */
export interface IntegrationPrFetchedPayload {
  /** The task this PR ingestion feeds. */
  readonly task_id: TaskID;
  /** The host the PR came from. */
  readonly provider: GitProviderType;
  /** The repo host path, e.g. `github.com/acme/api`. */
  readonly repo: string;
  /** PR / MR number. */
  readonly pr_number: number;
  /** Web URL of the PR. */
  readonly pr_url: string;
  /** Number of files in the fetched diff. */
  readonly file_count: number;
}

/** Payload for {@link import('./event-types.js').EventType.IntegrationTicketFetched}. */
export interface IntegrationTicketFetchedPayload {
  /** The task this ticket ingestion feeds. */
  readonly task_id: TaskID;
  /** The ticket system the issue came from. */
  readonly provider: TicketProviderType;
  /** Host issue key, e.g. `ACME-1234`. */
  readonly issue_key: string;
}

/** Payload for {@link import('./event-types.js').EventType.ReviewReportCreated}. */
export interface ReviewReportCreatedPayload {
  /** The task the report reviews. */
  readonly task_id: TaskID;
  readonly review_report_id: ReviewReportID;
  /** The PR URL reviewed. */
  readonly pr_url: string;
  /** Number of findings in the report. */
  readonly finding_count: number;
  /** Number of fix suggestions in the report. */
  readonly suggestion_count: number;
}

/** Payload for {@link import('./event-types.js').EventType.ReviewRequested}. */
export interface ReviewRequestedPayload {
  /** The task this review request belongs to. */
  readonly task_id: TaskID;
  /** The review report id (pre-created with placeholder data). */
  readonly review_report_id: ReviewReportID;
  /** The PR URL to review. */
  readonly pr_url: string;
  /** Optional Jira ticket key. */
  readonly jira_ticket?: string;
}

/** Payload for {@link import('./event-types.js').EventType.ReviewFixSuggestionCreated}. */
export interface ReviewFixSuggestionCreatedPayload {
  /** The task the suggestion belongs to. */
  readonly task_id: TaskID;
  readonly review_report_id: ReviewReportID;
  readonly fix_suggestion_id: FixSuggestionID;
  /** Repo-relative file the fix targets. */
  readonly file: string;
}

/** Payload for {@link import('./event-types.js').EventType.IntegrationWritebackCompleted}. */
export interface IntegrationWritebackCompletedPayload {
  /** The task the write-back belongs to. */
  readonly task_id: TaskID;
  readonly writeback_id: WritebackID;
  /** `pr` or `ticket`. */
  readonly target: 'pr' | 'ticket';
  /** `SUCCEEDED` or `FAILED`. */
  readonly status: 'SUCCEEDED' | 'FAILED';
}
