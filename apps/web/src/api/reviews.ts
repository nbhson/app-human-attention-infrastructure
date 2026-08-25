/**
 * AI review-slice API client (review-reorient Phase 3) — a thin typed wrapper
 * over the `POST/GET /api/reviews` endpoints added to `apps/api`. The pivot
 * surface: paste a PR URL (+ optional Jira ticket), read back the AI reviewer's
 * report + findings + fix suggestions, and record a human decision.
 */

const BASE = '/api/reviews';

/** Trust-loop anchor status: did the finding's `file:line` resolve into the diff? */
export type AnchorStatus = 'verified' | 'unverified';

/** The per-finding anchor verdict + a short human-readable reason. */
export interface FindingAnchor {
  readonly status: AnchorStatus;
  readonly detail: string;
}

/** A review finding as returned by `GET /api/reviews/:id`. */
export interface ReviewFinding {
  readonly id: string;
  readonly severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'NIT' | 'INFO';
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
  readonly suggestion: string | null;
  readonly orderIndex: number;
  readonly anchor: FindingAnchor;
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

/** One file's diff as returned by `GET /api/reviews/:id` (normalised `pr_payload.files`). */
export interface PrFile {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch: string;
}

/**
 * One model-call metadata row. NOTE: the stored `llm_call_log` is metadata-only —
 * there is deliberately no raw prompt/response transcript persisted for a review,
 * so this maps model + token counts + stop reason + a request hash, not the text.
 */
export interface LlmCall {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly stopReason: string | null;
  readonly requestHash: string;
  readonly createdAt: string;
}

/** One shadow-judge run against this report (scores are 0..1). */
export interface JudgeRun {
  readonly model: string;
  readonly promptVersion: string | null;
  readonly temperature: number | null;
  readonly severityAgreement: number;
  readonly routingAgreement: number;
  readonly evidenceSufficiency: number;
  readonly overall: number;
  readonly reasoning: string | null;
  readonly createdAt: string;
}

/** The "AI trace" payload: metadata about how this report was produced. */
export interface ReviewTrace {
  readonly calls: readonly LlmCall[];
  readonly judge: readonly JudgeRun[];
}

/** One persisted human decision on this report (audit). */
export interface ReviewDecisionRecord {
  readonly id: string;
  readonly decision: string;
  readonly rationale: string | null;
  readonly writebackEnabled: boolean;
  readonly createdAt: string;
}

/** One write-back attempt tied to a decision (audit). */
export interface WritebackRecord {
  readonly id: string;
  readonly provider: string;
  readonly action: string;
  readonly status: string;
  readonly externalRef: string | null;
  readonly error: string | null;
  readonly decisionId: string | null;
  readonly createdAt: string;
}

/** A review finding severity band. */
export type ReviewSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'NIT' | 'INFO';

/**
 * Derived statistics on the report, computed server-side from the stored PR
 * payload + findings. Surfaces the product's core promise: how many of the PR's
 * added lines sit in files with an actionable finding (→ how much of the diff
 * actually needs a human), split by severity.
 */
export interface ReviewStats {
  readonly totalFiles: number;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly changedLines: number;
  /** Added lines living in files carrying at least one actionable finding. */
  readonly flaggedAddedLines: number;
  /** Distinct files carrying at least one actionable finding (NIT/INFO excluded). */
  readonly flaggedFiles: number;
  /** `flaggedAddedLines / addedLines`, clamped to [0, 1]. */
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
  readonly diff: readonly PrFile[];
  readonly trace: ReviewTrace;
  readonly decisions: readonly ReviewDecisionRecord[];
  readonly writebacks: readonly WritebackRecord[];
  /**
   * The server's current write-back arming (the `WRITEBACK_ENABLED` ceiling).
   * When `enabled` is false the "write back" checkbox is not armed: toggling it
   * would be recorded as OFF, so the UI disables + explains it instead. Absent
   * only on a backend predating this field (treat as unarmed).
   */
  readonly writeback?: { readonly enabled: boolean };
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

/** One row in the AI-review list (`GET /api/reviews`). */
export interface ReviewsListItem {
  readonly id: string;
  readonly prUrl: string;
  readonly prNumber: number;
  readonly repo: string;
  readonly prTitle: string;
  readonly overallVerdict: ReviewReport['overallVerdict'];
  readonly createdAt: string;
  /** Whether a human decision has already been recorded for this report. */
  readonly decided: boolean;
}

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
  /** List reports; `pending=true` keeps only ones still awaiting a decision. */
  list(pending?: boolean): Promise<ReviewsListItem[]> {
    return json<ReviewsListItem[]>(fetch(`${BASE}${pending ? '?pending=1' : ''}`));
  },
  /** Read back the stored report, findings, and fix suggestions. */
  getReport(id: string): Promise<ReviewReport> {
    return json<ReviewReport>(fetch(`${BASE}/${id}`));
  },
  /**
   * Record the human verdict on a report, optionally arming a PR write-back.
   * `writeback` arms the request-level flag; `comment` overrides the default
   * decision-summary body. Both are gated server-side (never trusted here).
   */
  decide(
    id: string,
    input: { decision: ReviewDecision; writeback?: boolean; comment?: string },
  ): Promise<{ reportId: string; decision: string }> {
    return post<{ reportId: string; decision: string }>(`/${id}/decision`, {
      decision: input.decision,
      ...(input.writeback === true ? { writeback: true } : {}),
      ...(input.comment !== undefined && input.comment.trim().length > 0
        ? { comment: input.comment.trim() }
        : {}),
    });
  },
};
