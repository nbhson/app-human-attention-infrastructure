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
    private readonly timeoutMs = 30_000,
    private readonly maxRetries = 2,
  ) {}

  async fetchIssue(input: FetchIssueInput): Promise<Issue> {
    const path = `/rest/api/3/issue/${encodeURIComponent(input.key)}`;
    const payload = (await this.request(path)) as JiraIssuePayload;
    return mapJiraIssue(this.type, this.baseUrl, payload);
  }

  async postComment(input: FetchIssueInput, body: string): Promise<void> {
    void input;
    void body;
    throw new TicketProviderError('jira REST write-back is not supported — route through MCPTicketProvider');
  }

  async transition(input: FetchIssueInput, targetState: string): Promise<void> {
    void input;
    void targetState;
    throw new TicketProviderError('jira REST write-back is not supported — route through MCPTicketProvider');
  }

  private async request(path: string): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (this.token.length > 0) {
          headers.Authorization = `Bearer ${this.token}`;
        }
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          throw new TicketProviderError(
            `jira GET ${path} failed: ${response.status} ${response.statusText}`,
            response.status,
          );
        }
        return response.json();
      } catch (error) {
        lastError = error;
        const transient =
          error instanceof TicketProviderError
            ? error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504
            : error instanceof Error &&
              (error.name === 'AbortError' ||
                error.name === 'TimeoutError' ||
                /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(error.message));
        if (!transient || attempt === this.maxRetries) throw error;
        await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 4000) + Math.floor(Math.random() * 250)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('jira request retry exhausted');
  }
}
