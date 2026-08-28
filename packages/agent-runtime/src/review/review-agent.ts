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
 */

import type { LLMProvider } from '../llm/llm-provider.js';

import { parseReviewOutput } from './parse-review.js';
import { buildReviewPrompt } from './review-prompt.js';
import type { ReviewPromptInput } from './review-prompt.js';
import type { ReviewAgentOutput } from './review-output.js';

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
}
