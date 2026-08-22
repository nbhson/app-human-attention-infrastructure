/**
 * Embedder interface (day-16 §2.2) — the provider seam for semantic embeddings.
 *
 * An `Embedder` turns text into fixed-length unit vectors. It is *infra*, not a
 * ranking policy: the context engine consumes it as a replaceable capability,
 * exactly like `db`/`di`/`observability`. The semantic retriever (Day 18) sits
 * behind the `Ranker` seam; the default keyword ranker never touches this.
 *
 * The one iron rule (§2.2 rule 2, §6): an embedder must **never throw** into its
 * caller. A transient provider outage degrades to a logged no-op, so
 * `resolveContext` keeps running keyword-only while embeddings are down. Failures
 * are therefore a *value* — the discriminated {@link EmbedResult} — not an
 * exception. Ranking is a best-effort path; nothing on it is allowed to throw
 * because a flaky HTTP endpoint happened to be down.
 */

/** A typed, inspection-friendly embedding failure (never thrown). */
export interface EmbedError {
  readonly kind: 'embed_error';
  /** Human-readable reason, safe to log. */
  readonly message: string;
  /** True when a retry with backoff could plausibly succeed (429/5xx/network). */
  readonly retryable: boolean;
}

/**
 * The provider seam is contractually non-throwing (day-16 §2.2): unavailability
 * is a typed {@link EmbedError}, never an exception. A *misbehaving* embedder —
 * or a failure-injection fake — throws this, and the semantic retriever (day-26
 * §3.1) converts it back into a graceful degrade: keyword is served, the shadow
 * is skipped, and `context_semantic_fallback_total` is bumped.
 */
export class EmbeddingUnavailableError extends Error {
  override readonly name = 'EmbeddingUnavailableError';

  constructor(message = 'embedding provider unavailable') {
    super(message);
  }
}

/** The result of a batched {@link Embedder.embed}: success carries one vector
 * per input in the input's own order (callers rely on index alignment);
 * failure carries a typed error instead of a rejection. */
export type EmbedResult =
  | { readonly ok: true; readonly vectors: readonly number[][] }
  | { readonly ok: false; readonly error: EmbedError };

/** The result of a single {@link Embedder.embedQuery}. */
export type EmbedQueryResult =
  | { readonly ok: true; readonly vector: readonly number[] }
  | { readonly ok: false; readonly error: EmbedError };

/**
 * A text-embedding provider.
 *
 * `dimensions` is a property of the *adapter*, never a hand-typed literal in the
 * index (day-16 §6): mixed-dimension vectors make `vector_cosine_ops` error.
 */
export interface Embedder {
  /** The vector width this provider emits. */
  readonly dimensions: number;
  /** The provider/model name, recorded on every stored embedding. */
  readonly model: string;
  /** Batch-embed `texts`; order-preserving, one `dimensions`-vector per input. */
  embed(texts: readonly string[]): Promise<EmbedResult>;
  /** Embed a single query (may use a distinct instruction model upstream). */
  embedQuery(text: string): Promise<EmbedQueryResult>;
}
