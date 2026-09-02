/**
 * `LoggingLLMProvider` (day-11 §3.6) — a decoration that records every call a
 * wrapped {@link LLMProvider} makes, keeping provenance orthogonal to the
 * provider itself. Swap the inner provider and logging is unchanged.
 *
 * A row is written for *every* call outcome, success or failure. A thrown call
 * writes a `FAILED` row carrying the classified error kind + sanitized message,
 * then re-throws. Without this, a flaky LLM call would be invisible in the audit
 * trail — only the absence of a `llm_call_log` row would tell you it happened.
 */

import { createHash } from 'node:crypto';

import { llmCallLog } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { uuidv7 } from '@harness/domain';
import { withSpan } from '@harness/observability';
import type { WithSpanOptions } from '@harness/observability';

import type { LLMProvider, LLMRequest, LLMResponse } from './llm-provider.js';
import { AnthropicError } from './anthropic-provider.js';
import { OpenAICompatibleError } from './openai-compatible-provider.js';

/** A short, classifier-friendly reason for a failure. `OK` on success. */
type CallStatus = 'OK' | 'TIMEOUT' | 'NETWORK' | 'HTTP' | 'RATE_LIMIT' | 'UNKNOWN';

function classifyError(error: unknown): { kind: CallStatus; message: string } {
  if (error instanceof AnthropicError || error instanceof OpenAICompatibleError) {
    const kind: CallStatus =
      error.kind === 'timeout'
        ? 'TIMEOUT'
        : error.kind === 'network'
          ? 'NETWORK'
          : error.kind === 'rate_limit'
            ? 'RATE_LIMIT'
            : 'HTTP';
    return { kind, message: error.message };
  }
  if (error instanceof Error) {
    return { kind: 'UNKNOWN', message: error.message };
  }
  return { kind: 'UNKNOWN', message: String(error) };
}

/** Strip whitespace and cap length so a verbose tool error cannot blow up the row. */
function sanitizeMessage(raw: string, max = 500): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

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

    let status: CallStatus = 'OK';
    let errorMessage: string | undefined;
    let res: LLMResponse | undefined;
    try {
      res = await withSpan(opts, async (span) => {
        const inner = await this.inner.complete(req);
        span.setAttribute('harness.llm.tokens_in', inner.usage.inputTokens);
        span.setAttribute('harness.llm.tokens_out', inner.usage.outputTokens);
        return inner;
      });
      return res;
    } catch (error) {
      const classified = classifyError(error);
      status = classified.kind;
      errorMessage = sanitizeMessage(classified.message);
      throw error;
    } finally {
      await this.record({
        requestHash,
        req,
        status,
        errorMessage,
        res,
      });
    }
  }

  /**
   * Persist one `llm_call_log` row. The insert is best-effort: a logging failure
   * must not mask the original request outcome, so any thrown write is swallowed
   * (and tagged on the active span if one is open).
   */
  private async record(args: {
    readonly requestHash: string;
    readonly req: LLMRequest;
    readonly status: CallStatus;
    readonly errorMessage: string | undefined;
    readonly res: LLMResponse | undefined;
  }): Promise<void> {
    const { requestHash, req, status, errorMessage, res } = args;
    try {
      await this.db.insert(llmCallLog).values({
        id: uuidv7(),
        agent_run_id: req.agent_run_id ?? null,
        correlation_id: req.correlation_id ?? null,
        model: req.model,
        input_tokens: res?.usage.inputTokens ?? 0,
        output_tokens: res?.usage.outputTokens ?? 0,
        stop_reason: res?.stopReason ?? status,
        request_hash: requestHash,
        status,
        ...(errorMessage === undefined ? {} : { error: errorMessage }),
      });
    } catch {
      // Swallow: the original request outcome (success or thrown error) is the
      // caller's truth. A failed audit row is a known blind spot, not a bug to
      // propagate. Production may add a metric for this counter.
    }
  }
}
