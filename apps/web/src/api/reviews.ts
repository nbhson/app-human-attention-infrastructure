/**
 * AI review-slice API client (review-reorient Phase 3) — a thin typed wrapper
 * over the `POST/GET /api/reviews` endpoints added to `apps/api`. The pivot
 * surface: paste a PR URL (+ optional Jira ticket), read back the AI reviewer's
 * report + findings + fix suggestions, and record a human decision.
 */

const BASE = '/api/reviews';

/** A review finding as returned by `GET /api/reviews/:id`. */
export interface ReviewFinding {
  readonly id: string;
  readonly severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'NIT' | 'INFO';
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
  readonly suggestion: string | null;
  readonly orderIndex: number;
}

/** A fix suggestion as returned by `GET /api/reviews/:id`. */
export interface FixSuggestion {
  readonly id: string;
  readonly file: string;
  readonly hunk: string | null;
  readonly proposed: string;
  readonly rationale: string;
  readonly orderIndex: number;
}

/** A review finding severity band. */
export type ReviewSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'NIT' | 'INFO';

/**
 * Derived statistics on the report, computed server-side from the stored PR
 * payload + findings. Surfaces the product's core promise: how much of the PR's
 * changed surface actually needs a human to look at it, split by severity.
 */
export interface ReviewStats {
  readonly totalFiles: number;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly changedLines: number;
  /** Distinct `file:line` anchors a finding points at (line-level findings only). */
  readonly flaggedLines: number;
  /** Distinct files carrying at least one finding. */
  readonly flaggedFiles: number;
  /** `flaggedLines / changedLines`, clamped to [0, 1]. */
  readonly attentionShare: number;
  readonly findingTotal: number;
  readonly severity: Record<ReviewSeverity, number>;
}

/** The composed report as returned by `GET /api/reviews/:id`. */
export interface ReviewReport {
  readonly id: string;
  readonly prUrl: string;
  readonly prNumber: number;
  readonly repo: string;
  readonly prTitle: string;
  readonly aiProvider: string;
  readonly model: string;
  readonly summary: string;
  readonly overallVerdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  readonly createdAt: string;
  /** Derived statistics; absent when the backend serves a report without them. */
  readonly stats?: ReviewStats;
  readonly findings: readonly ReviewFinding[];
  readonly suggestions: readonly FixSuggestion[];
}

/** Response of `POST /api/reviews`. */
export interface ReviewCreatedResult {
  readonly reportId: string;
  readonly taskId: string;
  readonly prUrl: string;
  readonly overallVerdict: string;
  readonly findingCount: number;
  readonly suggestionCount: number;
}

/** One of the three human decisions the review report accepts. */
export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

/** An API failure with a status code, so the UI can branch on 400/503/… */
export class ReviewsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewsApiError';
  }
}

async function json<T>(res: Promise<Response>): Promise<T> {
  const response = await res;
  const body = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new ReviewsApiError(response.status, body.error ?? `request failed (${response.status})`);
  }
  return body as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return json<T>(
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export const reviewsApi = {
  /** Kick off an AI review for a PR URL (+ optional Jira ticket). */
  create(input: { prUrl: string; jiraTicket?: string }): Promise<ReviewCreatedResult> {
    return post<ReviewCreatedResult>('', {
      prUrl: input.prUrl,
      ...(input.jiraTicket !== undefined && input.jiraTicket.trim().length > 0
        ? { jiraTicket: input.jiraTicket }
        : {}),
    });
  },
  /** Read back the stored report, findings, and fix suggestions. */
  getReport(id: string): Promise<ReviewReport> {
    return json<ReviewReport>(fetch(`${BASE}/${id}`));
  },
  /** Record the human verdict on a report. */
  decide(id: string, decision: ReviewDecision): Promise<{ reportId: string; decision: string }> {
    return post<{ reportId: string; decision: string }>(`/${id}/decision`, { decision });
  },
};
