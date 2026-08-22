/**
 * Review API client (day-23 §2.4) — a thin typed wrapper over the Day-22
 * endpoints exposed by `apps/api`. All review logic lives on the server; this
 * module only serialises requests and parses responses.
 *
 * Identity is the httpOnly `sid` session cookie set by `/api/auth/*` (day-02
 * §2.2): the days of sending a fabricated `VITE_REVIEWER_ID` / `reviewerId` body
 * are gone — the server sources the reviewer from `request.auth`. The browser
 * must log in once (SSO) and the cookie rides along on every request.
 */

const BASE = '/api/review';

/** A queue row as returned by `GET /api/review/queue`. */
export interface QueueListItem {
  readonly id: string;
  readonly taskId: string;
  readonly assessmentId: string;
  readonly changeId: string;
  readonly action: string;
  readonly position: number;
  readonly status: string;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly createdAt: string;
  readonly label: string;
  readonly combinedPriority: number;
  readonly taskTitle: string;
  readonly flaky: boolean;
  readonly ruleId: string;
  readonly policyVersion: number;
}

/** One factor score + availability flag (day-23 §2.3). */
export interface FactorScore {
  readonly key: string;
  readonly score: number;
  readonly available: boolean;
}

/** One verification check with an evidence link (day-23 §2.3). */
export interface VerificationCheckView {
  readonly kind: string;
  readonly status: string;
  readonly evidenceId: string | null;
}

/** One file's Day-17 unified diff (day-23 §2.3). */
export interface ReviewFileDiff {
  readonly path: string;
  readonly hunks: string;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly isNewFile: boolean;
}

/** The composed detail payload (day-22 §2.4 + day-23 §2.3). */
export interface QueueItemDetail {
  readonly id: string;
  readonly taskId: string;
  readonly assessmentId: string;
  readonly changeId: string;
  readonly action: string;
  readonly position: number;
  readonly status: string;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly createdAt: string;
  readonly label: string;
  readonly combinedPriority: number;
  readonly ruleId: string;
  readonly policyVersion: number;
  readonly taskTitle: string;
  readonly taskState: string;
  readonly factors: readonly FactorScore[];
  readonly checks: readonly VerificationCheckView[];
  readonly diffs: readonly ReviewFileDiff[];
  readonly decision: {
    readonly decision: string;
    readonly reviewerId: string;
    readonly rationale: string | null;
    readonly at: string;
  } | null;
}

/** An evidence body (day-23 §2.3). */
export interface EvidenceRecord {
  readonly id: string;
  readonly kind: string;
  readonly body: string;
}

/** One of the two reviewer decisions accepted by the Phase-1 API. */
export type DecisionChoice = 'APPROVE' | 'REJECT';

/** A decide request body (day-22 §2.1). */
export interface DecideInput {
  readonly decision: DecisionChoice;
  readonly rationale: string;
  readonly wasUseful: boolean;
  readonly comment?: string;
}

/** An API failure with a status code, so the UI can branch on 409. */
export class ReviewApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewApiError';
  }
}

async function json<T>(res: Promise<Response>): Promise<T> {
  const response = await res;
  const body = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new ReviewApiError(response.status, body.error ?? `request failed (${response.status})`);
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

export const reviewApi = {
  listQueue(): Promise<QueueListItem[]> {
    return json<QueueListItem[]>(fetch(`${BASE}/queue`));
  },
  getDetail(id: string): Promise<QueueItemDetail> {
    return json<QueueItemDetail>(fetch(`${BASE}/queue/${id}`));
  },
  getEvidence(id: string): Promise<EvidenceRecord> {
    return json<EvidenceRecord>(fetch(`${BASE}/evidence/${id}`));
  },
  claim(id: string): Promise<QueueItemDetail> {
    return post<QueueItemDetail>(`/queue/${id}/claim`, {});
  },
  decide(id: string, input: DecideInput): Promise<QueueItemDetail> {
    return post<QueueItemDetail>(`/queue/${id}/decide`, { ...input });
  },
  drop(id: string, rationale: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>(`/queue/${id}/drop`, { rationale });
  },
  release(id: string): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>(`/queue/${id}/release`, {});
  },
  escalate(id: string, rationale: string): Promise<QueueItemDetail> {
    return post<QueueItemDetail>(`/queue/${id}/escalate`, { rationale });
  },
};
