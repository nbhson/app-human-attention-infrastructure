/**
 * Query rewriter (day-28 §2.1, §3.1) — the RAG-Fusion variant-generation step,
 * behind the `LLMProvider` seam.
 *
 * Given one task query, ask the model for `k` *distinct* rewritten search-query
 * variants (one per line). The variants are the recall-side of RAG fusion: each
 * is retrieved independently, and the union is fused. The rewrite is the *only*
 * extra LLM call — `k` is a cap on variants, not on calls.
 *
 * Cost and correctness guards (day-28 §2.3, §2.4):
 *
 * - **cap** — `k` is clamped to {@link MAX_VARIANT_COUNT} so loss of control of
 *   the prompt can't fan the spend out.
 * - **timeout** — the call is raced against {@link REWRITE_TIMEOUT_MS}; a hang
 *   rejects, which the `RagFusionRetriever` turns into a single-query fallback.
 * - **non-empty** — a rewrite that yields no usable variant *throws*, so the
 *   caller degrades to the base retriever rather than serve an empty context.
 *
 * The parse is deliberately conservative: lines only, de-numbered, de-duplicated,
 * truncated to `k`. It never trusts the model to have emitted a delimiter.
 */

import type { LLMProvider, LLMRequest } from '@harness/domain';

/** The default number of rewritten variants (day-28 §2.4). */
export const DEFAULT_VARIANT_COUNT = 3;
/** The hard ceiling on variants, whatever the caller asks for. */
export const MAX_VARIANT_COUNT = 5;
/** The rewrite-call latency budget; exceeding it rejects (→ fallback). */
export const REWRITE_TIMEOUT_MS = 8_000;

/** The variant-generation seam — a `RagFusionRetriever` talks to this, not the LLM. */
export interface QueryRewriter {
  rewrite(query: string, k: number): Promise<string[]>;
}

/**
 * The LLM-backed rewriter. On an empty/heavy-lift parse it throws, never returns
 * fewer than one variant silently — an empty result is a correctness bug the
 * caller must catch and fall back on.
 */
export class LLMQueryRewriter implements QueryRewriter {
  constructor(
    private readonly llm: LLMProvider,
    private readonly model: string,
    private readonly timeoutMs: number = REWRITE_TIMEOUT_MS,
  ) {}

  async rewrite(query: string, k = DEFAULT_VARIANT_COUNT): Promise<string[]> {
    const cap = Math.max(1, Math.min(k, MAX_VARIANT_COUNT));
    const request: LLMRequest = {
      model: this.model,
      messages: [{ role: 'user', content: query }],
      maxTokens: 256,
      systemPrompt:
        `Rewrite the query into ${cap} distinct search-query variants, one per line. ` +
        'Reply with plain lines only — no numbering, bullets, or prose.',
    };

    const response = await withTimeout(this.llm.complete(request), this.timeoutMs);
    const variants = parseVariants(response.content, cap);
    if (variants.length === 0) {
      throw new Error('query rewriter returned no usable variants');
    }
    return variants;
  }
}

/** Parse newline-separated variants: strip list markers, dedupe, cap. */
export function parseVariants(content: string, cap: number): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw
      .trim()
      .replace(/^[-*\d.)\s]+/, '')
      .trim();
    if (line.length === 0) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(line);
    if (variants.length >= cap) break;
  }
  return variants;
}

/** Race `promise` against a timeout that rejects (→ the caller's fallback). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('query rewrite timed out')), ms);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}
