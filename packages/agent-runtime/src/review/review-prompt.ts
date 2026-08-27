/**
 * The AI reviewer's prompt (review-reorient Phase 3).
 *
 * The prompt grounds the model as a *reviewer*, not an author: it is given an
 * external diff plus a requirement, and must return ONLY a JSON object matching
 * the {@link ReviewAgentOutput} shape — a summary, a verdict, findings, and a
 * separate fix-suggestion list (the two distinct sections the UI renders).
 *
 * Day-01 (Phase 4 upgrade): `relatedMemories` injects past review findings,
 * decisions, and project context from the {@link MemoryProvider} seam so the
 * AI can consider historical patterns and avoid repeating past assessments.
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
  /**
   * Past review memories (findings, decisions, project context) retrieved for
   * this PR. When present, the prompt includes a "Related past reviews" section
   * so the AI can consider historical patterns.
   */
  readonly relatedMemories?: readonly {
    readonly kind: string;
    readonly content: string;
    readonly confidence: number;
    readonly metadata: Record<string, unknown>;
  }[];
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
      "kind": "correctness" | "cleanup",
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
- Be exhaustive and specific: review EVERY file and every non-trivial hunk in the diff, in order. Do not stop after the first few files, and do not summarise a whole file with one generic finding. Cite the concrete file and line for every claim; never invent a file that is not in the diff.
- A large diff has proportionally more real defects. On a large, non-trivial change a near-empty findings list almost always means you under-reviewed: go back and enumerate every defect you can defend, rather than stopping at the first issue. Prefer several small, precise findings over one vague paragraph.
- The DIFF contains every hand-written file in the pull request — source code, docs (README), config (package.json / *.yml / Dockerfile / .env / CI) and infrastructure alike. Only machine-generated artifacts (lockfiles, build output, source maps, minified bundles) have been removed. Review ALL of it, not just the code.
- For source files: review correctness and hidden bugs (edge cases, race conditions, null/undefined handling, off-by-one, resource leaks), clean code (dead code, duplication, magic numbers, confusing naming), and structure.
- For config / infra files (Dockerfile, CI, *.yml, package.json, .env): review for misconfiguration and security defects — hardcoded secrets, exposed ports, missing resource limits or healthchecks, unpinned image/tag/version, overly-permissive permissions. These are CRITICAL/MAJOR findings, not cosmetic.
- Order findings by severity (CRITICAL first), then file. Order suggestions in a natural apply order. If there is genuinely nothing wrong, return an empty findings array and overallVerdict "APPROVE".
- Set "kind" to "correctness" for a bug / logic defect (the action is to FIX it) and "cleanup" for dead code, duplication, magic numbers or confusing naming (the action is to REMOVE / SIMPLIFY).
- Do NOT report cosmetic issues (a missing trailing newline, whitespace, or formatting) at all. NIT is for a genuine small code improvement; INFO is for genuine praise. When the change is clean, return an empty findings array and overallVerdict "APPROVE".`;

export function buildReviewPrompt(input: ReviewPromptInput): ReviewPrompt {
  const requirement =
    input.requirement.trim().length > 0 ? input.requirement.trim() : '(none provided)';

  const memoriesSection = buildMemoriesSection(input.relatedMemories);

  const userMessage = [
    `PULL REQUEST: ${input.prUrl}`,
    `TITLE: ${input.prTitle}`,
    '',
    'REQUIREMENT:',
    requirement,
    ...(memoriesSection.length > 0 ? ['', memoriesSection] : []),
    '',
    'DIFF:',
    input.diff.trim(),
  ].join('\n');

  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}

/** Format related memories into a "Related past reviews" section for the prompt. */
function buildMemoriesSection(
  memories: readonly {
    readonly kind: string;
    readonly content: string;
    readonly confidence: number;
    readonly metadata: Record<string, unknown>;
  }[] = [],
): string {
  if (memories.length === 0) return '';

  const lines = ['RELATED PAST REVIEWS (for context):'];
  for (const mem of memories) {
    const meta = formatMetadata(mem.metadata);
    lines.push(`  [${mem.kind}] (confidence ${mem.confidence})${meta ? ` ${meta}` : ''}`);
    // Indent content so the AI can distinguish it from the diff.
    lines.push(`    ${mem.content.replace(/\n/g, '\n    ')}`);
  }
  lines.push('');
  lines.push(
    'Consider the past findings above when reviewing this PR. If a past finding is no',
    'longer relevant (already fixed, superseded, or unrelated), say so. Do not repeat',
    'a past finding that was already resolved — but do flag it if it has regressed.',
  );
  return lines.join('\n');
}

/** Extract a short metadata tag, e.g. severity or decision verdict. */
function formatMetadata(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof metadata.severity === 'string') parts.push(`severity=${metadata.severity}`);
  if (typeof metadata.decision === 'string') parts.push(`decision=${metadata.decision}`);
  if (typeof metadata.file === 'string') parts.push(`file=${metadata.file}`);
  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}
