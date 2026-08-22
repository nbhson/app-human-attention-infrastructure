/**
 * `LoggingLLMProvider` (day-11 §3.6) — a decoration that records every call a
 * wrapped {@link LLMProvider} makes, keeping provenance orthogonal to the
 * provider itself. Swap the inner provider and logging is unchanged.
 *
 * One `llm_call_log` row is written *after* the call succeeds. A thrown call
 * writes nothing (there is no response to log); the thrown error propagates to
 * the caller unchanged.
 */

import { createHash } from 'node:crypto';

import { llmCallLog } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { uuidv7 } from '@harness/domain';
import { withSpan } from '@harness/observability';
import type { WithSpanOptions } from '@harness/observability';

import type { LLMProvider, LLMRequest, LLMResponse } from './llm-provider.js';

export class LoggingLLMProvider implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly db: DrizzleDB,
  ) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const requestHash = createHash('sha256').update(JSON.stringify(req)).digest('hex');

    // Model + prompt is known up front; token counts only after the call. Bind
    // the correlation from the request (it is null off a run) so the span's
    // `harness.correlation_id` matches the llm_call_log row it will write.
    const opts: WithSpanOptions = {
      spanName: 'llm.completion',
      attributes: {
        'harness.llm.model': req.model,
        'harness.llm.prompt_hash': requestHash,
      },
      ...(req.correlation_id === undefined ? {} : { ctx: { correlationId: req.correlation_id } }),
    };
    const res = await withSpan(opts, async (span) => {
      const inner = await this.inner.complete(req);
      span.setAttribute('harness.llm.tokens_in', inner.usage.inputTokens);
      span.setAttribute('harness.llm.tokens_out', inner.usage.outputTokens);
      return inner;
    });

    await this.db.insert(llmCallLog).values({
      id: uuidv7(),
      agent_run_id: req.agent_run_id ?? null,
      correlation_id: req.correlation_id ?? null,
      model: req.model,
      input_tokens: res.usage.inputTokens,
      output_tokens: res.usage.outputTokens,
      stop_reason: res.stopReason,
      request_hash: requestHash,
    });

    return res;
  }
}
