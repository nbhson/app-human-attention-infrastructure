/**
 * `@harness/embeddings` — the text-embedding provider seam + semantic index.
 *
 * Public surface:
 * - `embedder` — the `Embedder` interface, `EmbedError`, result discriminator.
 * - `providers/stub` — `StubEmbedder` (deterministic, the DI default).
 * - `providers/openai-compatible` — `OpenAICompatibleEmbedder` (retrying, non-throwing).
 * - `indexer` — `EmbeddingIndexer` (day-17 §2.2 batch/resumable/idempotent).
 * - `sources` — backfill + artifact-event source gathering (day-17 §2.1, §2.3).
 * - `reembed-listener` — re-embed a FILE source on `artifact.created`/`changed`.
 * - `health` — `isFreshVector` + `computeIndexHealth` (day-17 §2.4, §3.4).
 * - `logger` — the structural `IndexLogger` seam.
 */

export * from './embedder.js';
export * from './providers/stub.js';
export * from './providers/openai-compatible.js';
export * from './indexer.js';
export * from './sources.js';
export * from './reembed-listener.js';
export * from './health.js';
export * from './logger.js';
