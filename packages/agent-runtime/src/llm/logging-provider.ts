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

import type { LLMProvider, LLMRequest, LLMResponse } from './llm-provider.js';

export class LoggingLLMProvider implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly db: DrizzleDB,
  ) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await this.inner.complete(req);
    const requestHash = createHash('sha256').update(JSON.stringify(req)).digest('hex');

    await this.db.insert(llmCallLog).values({
      id: uuidv7(),
      agent_run_id: null,
      model: req.model,
      input_tokens: res.usage.inputTokens,
      output_tokens: res.usage.outputTokens,
      stop_reason: res.stopReason,
      request_hash: requestHash,
    });

    return res;
  }
}
