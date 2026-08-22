/**
 * `pnpm embed:populate` — one-shot / backfill entry (day-17 §3.2).
 *
 * Gathers the existing context sources, embeds them through the env-selected
 * provider (StubEmbedder by default, OpenAI-compatible when `EMBEDDINGS_BASE_URL`
 * is set), and prints the run `Progress` plus the resulting `IndexHealth` so the
 * operator can see index completeness at a glance. Re-running is a no-op for
 * already-fresh sources (day-17 §2.2) — safe to run on a schedule and again
 * after a crash.
 */

import { isNotNull } from 'drizzle-orm';

import { contextSourceEmbeddings, createDb } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import type { Embedder } from './embedder.js';
import { computeIndexHealth } from './health.js';
import type { EmbeddingRowSignature } from './health.js';
import { EmbeddingIndexer } from './indexer.js';
import { OpenAICompatibleEmbedder } from './providers/openai-compatible.js';
import { StubEmbedder } from './providers/stub.js';
import { collectIndexSources } from './sources.js';

const DEFAULT_DB_URL = 'postgres://harness:harness@localhost:5432/harness';
const DEFAULT_BATCH_SIZE = 64;

function parseBatchSize(argv: readonly string[], fallback: number): number {
  const index = argv.indexOf('--batch');
  const raw = index === -1 ? undefined : argv[index + 1];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 1 ? value : fallback;
}

/** Same env-driven selection as `apps/api/src/bootstrap.ts` (day-16 §2.3). */
function makeEmbedder(): Embedder {
  const baseUrl = process.env.EMBEDDINGS_BASE_URL;
  if (!baseUrl) {
    return new StubEmbedder();
  }
  return new OpenAICompatibleEmbedder({
    baseUrl,
    apiKey: process.env.EMBEDDINGS_API_KEY ?? '',
    model: process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
  });
}

async function readEmbeddingRows(db: DrizzleDB): Promise<EmbeddingRowSignature[]> {
  const rows = await db
    .select({
      sourceId: contextSourceEmbeddings.source_id,
      contentHash: contextSourceEmbeddings.content_hash,
      embedded: isNotNull(contextSourceEmbeddings.embedding),
    })
    .from(contextSourceEmbeddings);
  return rows.map((row) => ({
    sourceId: row.sourceId,
    contentHash: row.contentHash,
    embedded: row.embedded === true,
  }));
}

async function main(): Promise<void> {
  const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DB_URL);
  const batchSize = parseBatchSize(process.argv, DEFAULT_BATCH_SIZE);
  const indexer = new EmbeddingIndexer(db, makeEmbedder());

  const sources = await collectIndexSources(db);
  const progress = await indexer.run(sources, batchSize, (p) => {
    console.log(`embedded=${p.embedded}/${p.total} failed=${p.failed} stale=${p.stale}`);
  });

  const health = computeIndexHealth(
    sources.map((source) => ({
      sourceId: source.sourceId,
      contentHash: source.contentHash,
    })),
    await readEmbeddingRows(db),
  );

  console.log(JSON.stringify({ progress, health }, null, 2));
}

main().catch((error) => {
  console.error('embed:populate failed:', error);
  process.exitCode = 1;
});
