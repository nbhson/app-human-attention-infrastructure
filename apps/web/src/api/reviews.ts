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
  /** What to do about it: fix (`correctness`) vs remove/simplify (`cleanup`). */
  readonly kind: 'correctness' | 'cleanup';
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

/** The review-slice machine-verification lifecycle (clone → build → test). */
export type ReviewVerificationStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED' | 'ERROR';

/**
 * A machine-side verification run over the report (wedge #1): the PR is cloned at
 * its head SHA and its own `build` then `test` scripts are run in the Docker
 * sandbox. A FAILED run is information, never a gate — the human still decides.
 */
export interface ReviewVerification {
  readonly status: ReviewVerificationStatus;
  /** PASSED / FAILED once the run completes; null while pending/running/skipped. */
  readonly overall: 'PASSED' | 'FAILED' | null;
  readonly headSha: string | null;
  readonly contentHash: string | null;
  readonly durationMs: number | null;
  readonly failedKinds: readonly string[];
  readonly timedOutKinds: readonly string[];
  readonly failedChecks: readonly {
    readonly kind: string;
    readonly status: string;
    readonly exitCode?: number;
    readonly tail: string;
  }[];
  /** Pre-rendered markdown of the flag (for a raw read, not styled). */
  readonly rendered: string | null;
  readonly error: string | null;
}

/** A review finding severity band. */
export type ReviewSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'NIT' | 'INFO';

/**
 * Derived statistics on the report, computed server-side from the stored PR
 * payload + findings. Surfaces the product's core promise: what share of the
 * PR's hand-written files carry an actionable finding (→ how much of the change
 * actually needs a human), split by severity. The attention share is file-based,
 * so it is provable from the findings' `file` fields.
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
  /** The diff split by what the added lines are (test/style/markup/source/config). */
  readonly composition: readonly {
    readonly category: 'test' | 'style' | 'markup' | 'source' | 'config';
    readonly files: number;
    readonly additions: number;
    readonly deletions: number;
  }[];
  /**
   * The diff split by **language** (GitHub-linguist names), weighted by changed
   * lines. `share` is each language's share of the whole reviewable diff in
   * `[0, 1]`; unrecognised paths pool under `'Other'`.
   */
  readonly languages: readonly {
    readonly language: string;
    readonly files: number;
    readonly additions: number;
    readonly deletions: number;
    readonly share: number;
  }[];
  /** Generated artifacts (lockfiles/build output) rejected from the metric. */
  readonly excluded: {
    readonly files: number;
    readonly additions: number;
    readonly deletions: number;
    /** The rejected files, named — the proof of what the denominator leaves out. */
    readonly filesList: readonly {
      readonly path: string;
      readonly additions: number;
      readonly deletions: number;
    }[];
  };
  /** Files carrying an actionable finding — the proof of `attentionShare`. */
  readonly flaggedFilesList: readonly {
    readonly file: string;
    readonly severities: readonly string[];
  }[];
  /** Cleanup opportunities (dead code / duplication), a parallel signal to attention. */
  readonly cleanup: {
    readonly files: number;
    readonly findings: number;
    readonly filesList: readonly { readonly file: string; readonly count: number }[];
  };
  /** `flaggedFiles / totalFiles`, clamped to [0, 1]. */
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
  /**
   * Current stage of the async review pipeline. `'complete'` means the review
   * has finished processing; any other value means the background worker is
   * still working.
   */
  readonly reviewStatus: 'pending' | 'fetching' | 'recalling' | 'reviewing' | 'storing' | 'complete' | 'error';
  /**
   * Batch progress within the `reviewing` stage. `current` is the number of
   * batches completed, `total` is the total number of batches. Only present
   * when `reviewStatus` is `'reviewing'`.
   */
  readonly batchProgress: { readonly current: number; readonly total: number } | null;
  /**
   * The recommendation after the triage rules are applied. Equals `overallVerdict`
   * unless the security rule downgrades it to REQUEST_CHANGES. The raw AI verdict
   * stays in `overallVerdict` — the override is never a rewrite.
   */
  readonly effectiveVerdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  /** Which triage rules fired, and why. */
  readonly triage: TriageSummary;
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
  /**
   * The machine-side verification run (wedge #1), `null` when none has been
   * recorded yet. FAILED is information, not a gate — the human still decides.
   */
  readonly verification?: ReviewVerification | null;
}

/** Response of `POST /api/reviews` (async — starts background processing). */
export interface ReviewCreatedResult {
  readonly reportId: string;
  readonly taskId: string;
  readonly prUrl: string;
  readonly status: 'pending';
}

/** One of the three human decisions the review report accepts. */
export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';

/** The queue's urgency axis, derived server-side from the report's risk score. */
export type PriorityLevel = 'high' | 'medium' | 'low';

/** A PR's source → target branch, as stored on the pull-request payload. */
export interface ReviewBranch {
  readonly source: string | null;
  readonly target: string | null;
}

/** Short ids of the triage rules that actually fired (mapped to labels in the UI). */
export type TriageRuleId = 'security-block' | 'performance-regression' | 'schema-integrity';

/**
 * The rule-derived triage block attached to a list row or report. Derived
 * server-side from the report's findings + PR paths + (on the report) the shadow
 * judge — never invented. `regressionRisk` is only present where the judge run
 * is actually loaded (the report), because that claim needs a judge signal.
 */
export interface TriageSummary {
  readonly securityBlocked: boolean;
  readonly regressionRisk?: boolean;
  readonly schemaGate: boolean;
  readonly matchedRules: readonly TriageRuleId[];
}

/** One finding in the list's per-review expandable summary. */
export interface ReviewListFinding {
  readonly severity: string;
  readonly kind: string;
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
}

/** Counts from `GET /api/reviews/summary` for the sidebar badges + header KPIs. */
export interface ReviewListSummary {
  readonly pendingCount: number;
  readonly decidedCount: number;
  readonly approvedCount: number;
}

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
  /** The latest human decision, or `null` while undecided. */
  readonly decision: ReviewDecision | null;
  /** How many findings the report carries (shown in the queue without a full read). */
  readonly findingCount: number;
  /** PR author's host username (no display name/avatar is stored). */
  readonly author: string | null;
  readonly branch: ReviewBranch;
  readonly additions: number;
  readonly deletions: number;
  readonly filesChanged: number;
  /** Deterministic 0-100 risk derived from the findings' severity. */
  readonly riskScore: number;
  readonly priority: PriorityLevel;
  /** Count of CRITICAL findings (the "Critical AST Issues" header metric). */
  readonly criticalFindings: number;
  readonly findings: readonly ReviewListFinding[];
  /** Rule-derived override; equals `overallVerdict` unless the security rule fires. */
  readonly effectiveVerdict: ReviewReport['overallVerdict'];
  /** Which triage rules fired at list level (security + schema; no judge here). */
  readonly triage: Pick<TriageSummary, 'securityBlocked' | 'schemaGate' | 'matchedRules'>;
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
      ...(input.jiraTicket !== undefined && input.jiraTicket.trim().length > 0 ? { jiraTicket: input.jiraTicket } : {}),
    });
  },
  /** List reports; `pending=true` keeps only ones still awaiting a decision. */
  list(pending?: boolean): Promise<ReviewsListItem[]> {
    return json<ReviewsListItem[]>(fetch(`${BASE}${pending ? '?pending=1' : ''}`));
  },
  /** Lightweight pending/decided/approved counts for the sidebar + header KPIs. */
  summary(): Promise<ReviewListSummary> {
    return json<ReviewListSummary>(fetch(`${BASE}/summary`));
  },
  /** Read back the stored report, findings, and fix suggestions. */
  getReport(id: string): Promise<ReviewReport> {
    return json<ReviewReport>(fetch(`${BASE}/${id}`));
  },
  /** Re-run a failed review: resets status to pending and re-publishes the worker event. */
  retry(id: string): Promise<{ reportId: string; status: 'pending' }> {
    return post<{ reportId: string; status: 'pending' }>(`/${id}/retry`, {});
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
      ...(input.comment !== undefined && input.comment.trim().length > 0 ? { comment: input.comment.trim() } : {}),
    });
  },
};
