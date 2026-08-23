/**
 * `JiraProvider` (review-reorient Phase 3) — the Jira-backed
 * {@link TicketProvider}, using the Cloud REST API over `fetch`.
 */

import { TicketProviderType } from '@harness/domain';
import type { Issue } from '@harness/domain';

import { TicketProviderError } from './ticket-provider.js';
import type { FetchIssueInput, TicketProvider } from './ticket-provider.js';
import { mapJiraIssue } from './jira-mapper.js';
import type { JiraIssuePayload } from './jira-mapper.js';

export class JiraProvider implements TicketProvider {
  readonly type = TicketProviderType.Jira;

  constructor(
    private readonly token: string,
    private readonly baseUrl: string,
  ) {}

  async fetchIssue(input: FetchIssueInput): Promise<Issue> {
    const path = `/rest/api/3/issue/${encodeURIComponent(input.key)}`;
    const payload = (await this.request(path)) as JiraIssuePayload;
    return mapJiraIssue(this.type, this.baseUrl, payload);
  }

  private async request(path: string): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token.length > 0) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'GET', headers });
    if (!response.ok) {
      throw new TicketProviderError(
        `jira GET ${path} failed: ${response.status} ${response.statusText}`,
        response.status,
      );
    }
    return response.json();
  }
}
