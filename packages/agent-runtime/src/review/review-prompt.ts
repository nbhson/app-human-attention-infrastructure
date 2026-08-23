/**
 * The AI reviewer's prompt (review-reorient Phase 3).
 *
 * The prompt grounds the model as a *reviewer*, not an author: it is given an
 * external diff plus a requirement, and must return ONLY a JSON object matching
 * the {@link ReviewAgentOutput} shape — a summary, a verdict, findings, and a
 * separate fix-suggestion list (the two distinct sections the UI renders).
 */

export interface ReviewPromptInput {
  /** The PR web URL, for provenance. */
  readonly prUrl: string;
  /** The PR title. */
  readonly prTitle: string;
  /** The requirement (ticket text) the diff should satisfy; may be empty. */
  readonly requirement: string;
  /** The unified diff (per-file patches concatenated). */
  readonly diff: string;
}

export interface ReviewPrompt {
  readonly systemPrompt: string;
  readonly userMessage: string;
}

const SYSTEM_PROMPT = `You are a senior code reviewer. You review an external pull request against its requirement. You never write code into a repository — you only produce a review.

Return ONLY one JSON object, no prose, no markdown fences. The object must match exactly:

{
  "summary": "<2–5 sentence executive summary of what the change does and whether it meets the requirement>",
  "overallVerdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "findings": [
    {
      "severity": "CRITICAL" | "MAJOR" | "MINOR" | "NIT" | "INFO",
      "file": "<repo-relative path>",
      "line": <optional integer>,
      "message": "<what is wrong>",
      "suggestion": "<optional inline pointer at how to fix it, without code>"
    }
  ],
  "suggestions": [
    {
      "file": "<repo-relative path>",
      "hunk": "<optional @@ -l,c +l,c @@ region the fix applies to>",
      "proposed": "<the proposed replacement code>",
      "rationale": "<why this change is correct>"
    }
  ]
}

Rules:
- "findings" are problems. "suggestions" are concrete fixes. A finding may exist without a matching suggestion, and vice-versa.
- Order findings by severity (CRITICAL first), then file. Order suggestions in a natural apply order.
- If there is nothing wrong, return an empty findings array and overallVerdict "APPROVE".
- Be specific: reference actual files and lines from the diff. Never invent a file that is not in the diff.`;

export function buildReviewPrompt(input: ReviewPromptInput): ReviewPrompt {
  const requirement =
    input.requirement.trim().length > 0 ? input.requirement.trim() : '(none provided)';
  const userMessage = [
    `PULL REQUEST: ${input.prUrl}`,
    `TITLE: ${input.prTitle}`,
    '',
    'REQUIREMENT:',
    requirement,
    '',
    'DIFF:',
    input.diff.trim(),
  ].join('\n');

  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
