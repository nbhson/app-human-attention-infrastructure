/**
 * `@harness/embeddings` — the text-embedding provider seam (day-16).
 *
 * Public surface:
 * - `embedder` — the `Embedder` interface, `EmbedError`, result discriminator.
 * - `providers/stub` — `StubEmbedder` (deterministic, the DI default).
 * - `providers/openai-compatible` — `OpenAICompatibleEmbedder` (retrying, non-throwing).
 */

export * from './embedder.js';
export * from './providers/stub.js';
export * from './providers/openai-compatible.js';
