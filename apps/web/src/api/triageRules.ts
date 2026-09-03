/**
 * Triage-rules API client — a thin typed wrapper over `GET/PUT /api/triage-rules`.
 * The three wired rules map one-to-one onto the `triage_rules` singleton row:
 * `securityBlock` (rule 1), `performanceRegression` (rule 2), `schemaIntegrity`
 * (rule 3). Rules 4 & 5 have no backend state and never reach this client.
 * The optional "instructions" flow (PR + Jira + text.md + AI) is exposed via
 * `includeInstructions` + `instructionsContent`.
 */

const BASE = '/api/triage-rules';

/** The triage-rule toggles + optional operator instructions ("text.md"). */
export interface TriageRuleState {
  readonly securityBlock: boolean;
  readonly performanceRegression: boolean;
  readonly schemaIntegrity: boolean;
  /**
   * When true, the review agent returns ALL findings (including MINOR, NIT, INFO)
   * — full code-review mode. When false (default), only high-signal findings
   * (CRITICAL/MAJOR) are shown.
   */
  readonly autoReviewEnabled: boolean;
  /**
   * When true and {@link instructionsContent} is non-empty, the uploaded
   * instructions/skill text is injected into the review prompt (PR + Jira +
   * text.md + AI flow). When false (default), the flow stays PR + Jira + AI.
   */
  readonly includeInstructions: boolean;
  /** The operator-supplied instructions / skill text (markdown). */
  readonly instructionsContent: string;
}

/** An API failure carrying a status code so the page can branch on it. */
export class TriageRulesError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TriageRulesError';
  }
}

async function request<T>(res: Promise<Response>): Promise<T> {
  const response = await res;
  const body = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new TriageRulesError(response.status, body.error ?? `request failed (${response.status})`);
  }
  return body as T;
}

export const triageRulesApi = {
  /** Read the current rule state (defaults all-ON before the row is seeded). */
  get(): Promise<TriageRuleState> {
    return request<TriageRuleState>(fetch(BASE));
  },
  /** Upsert a partial patch (absent keys are left unchanged). */
  update(patch: Partial<TriageRuleState>): Promise<TriageRuleState> {
    return request<TriageRuleState>(
      fetch(BASE, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    );
  },
};
