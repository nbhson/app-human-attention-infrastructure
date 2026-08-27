/**
 * `ReviewAgent` (review-reorient Phase 3) — the read-only reviewer.
 *
 * Unlike `AgentRunner` (which writes code through `write_file`), the reviewer
 * has no tools: it takes a PR diff + requirement, asks the model for a single
 * JSON review via {@link buildReviewPrompt}, and returns a validated
 * {@link ReviewAgentOutput} through {@link parseReviewOutput}.
 *
 * The class holds only an {@link LLMProvider}, so a `MockLLM` can drive it in
 * tests and the same agent runs against Anthropic, OpenAI-compatible, or any
 * other provider wired behind the seam.
 *
 * Phase-4 upgrade: `review` now accepts `relatedMemories` in its input, and
 * `summarizeFiles` is a lightweight two-pass helper that returns a file-level
 * risk assessment before the detailed review.
 */

import type { LLMProvider } from '../llm/llm-provider.js';

import { parseReviewOutput } from './parse-review.js';
import { buildReviewPrompt } from './review-prompt.js';
import type { ReviewPromptInput } from './review-prompt.js';
import type { FileSummary, ReviewAgentOutput } from './review-output.js';

export interface ReviewAgentOptions {
  /** Model id to review with, e.g. `'claude-sonnet-4-6'`. */
  readonly model: string;
  readonly maxTokens?: number;
  /** Task lifecycle id recorded into `llm_call_log.correlation_id` by `LoggingLLMProvider`. */
  readonly correlationId?: string;
}

export class ReviewAgent {
  constructor(
    private readonly llm: LLMProvider,
    /** Default `maxTokens` when a request doesn't supply its own. A reasoning-capable
     *  model spends output budget on both its chain-of-thought and the review JSON, so
     *  this needs headroom over the ~8k an ordinary model would use (see `AI_MAX_TOKENS`). */
    private readonly defaultMaxTokens = 8000,
  ) {}

  async review(input: ReviewPromptInput, opts: ReviewAgentOptions): Promise<ReviewAgentOutput> {
    const prompt = buildReviewPrompt(input);
    const response = await this.llm.complete({
      model: opts.model,
      messages: [{ role: 'user', content: prompt.userMessage }],
      maxTokens: opts.maxTokens ?? this.defaultMaxTokens,
      systemPrompt: prompt.systemPrompt,
      ...(opts.correlationId !== undefined ? { correlation_id: opts.correlationId } : {}),
    });
    return parseReviewOutput(response.content);
  }

  /**
   * Phase-4 two-pass: return a lightweight, file-level risk assessment for a set
   * of files. The AI is asked to summarise each file's change and flag its risk
   * level, without deep-diving into detailed findings. Callers use this to decide
   * which files to review in detail.
   */
  async summarizeFiles(input: ReviewPromptInput, opts: ReviewAgentOptions): Promise<FileSummary[]> {
    const summaryPrompt = buildSummaryPrompt(input);
    const response = await this.llm.complete({
      model: opts.model,
      messages: [{ role: 'user', content: summaryPrompt.userMessage }],
      maxTokens: Math.min(opts.maxTokens ?? this.defaultMaxTokens, 4000),
      systemPrompt: summaryPrompt.systemPrompt,
      ...(opts.correlationId !== undefined ? { correlation_id: opts.correlationId } : {}),
    });
    return parseFileSummary(response.content);
  }
}

/** Build a lightweight prompt for the two-pass summary pass. */
function buildSummaryPrompt(input: ReviewPromptInput): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = `You are a code-review triage assistant. Your job is to scan a set of file diffs and return a JSON array of file-level summaries, one entry per file.

Return ONLY a JSON array, no prose, no markdown fences. Each entry:
{
  "file": "<repo-relative path>",
  "risk": "high" | "medium" | "low",
  "summary": "<1-2 sentence description of the change and why it matters>"
}

Rules:
- "high" risk: the change touches core logic, security, data handling, or critical infrastructure.
- "medium" risk: the change is non-trivial but isolated (e.g., a new helper, a moderate refactor).
- "low" risk: the change is trivial (rename, comment, formatting, dead-code removal, simple config).
- Be conservative: default to "low" unless you see a clear reason to flag it higher.
- Summarise concisely — this is a triage pass, not a full review.`;

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

  return { systemPrompt, userMessage };
}

/** Parse the JSON array of file summaries from the model's response. */
function parseFileSummary(raw: string): FileSummary[] {
  // Strip markdown fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: FileSummary[] = [];
  for (const item of parsed) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const file = typeof obj.file === 'string' ? obj.file : '';
    const risk =
      typeof obj.risk === 'string' && ['high', 'medium', 'low'].includes(obj.risk)
        ? (obj.risk as 'high' | 'medium' | 'low')
        : 'low';
    const summary = typeof obj.summary === 'string' ? obj.summary : '';
    if (file.length === 0) continue;
    out.push({ file, risk, summary });
  }
  return out;
}
