/**
 * `@harness/ticket-provider` — the ticket-system read seam (review-reorient
 * Phase 3).
 *
 * Public surface:
 * - `ticket-provider` — the `TicketProvider` interface, `FetchIssueInput`,
 *   `TicketProviderError`.
 * - `jira-provider` — `JiraProvider` (Cloud REST over `fetch`).
 * - `jira-mapper` — the pure `mapJiraIssue` + `adfToPlainText` (fixtures-testable).
 */

export * from './ticket-provider.js';
export * from './jira-provider.js';
export * from './jira-mapper.js';
