/**
 * Source gathering for the semantic index (day-17 §2.1, §2.3).
 *
 * Two origins feed the index:
 *  - the backfill (`collectIndexSources`) — the *existing* context sources that
 *    Phase-1 resolution persisted into `contexts.sources` jsonb; and
 *  - the re-embed listener (`sourceFromCreated` / `resolveChangedSource`) — an
 *    artifact event mapped back to the FILE source it belongs to (day-17 §6:
 *    key on the source, never build a second identity for the same content).
 */

import { desc, eq } from 'drizzle-orm';

import { artifacts, contexts, snapshots } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { ContextSourceType } from '@harness/domain';
import type { ArtifactChangedPayload, ArtifactCreatedPayload } from '@harness/domain';

import type { SourceCandidate } from './indexer.js';

const SOURCE_TYPES = new Set<string>(Object.values(ContextSourceType));

function isContextSourceType(value: unknown): value is ContextSourceType {
  return typeof value === 'string' && SOURCE_TYPES.has(value);
}

/** A single `contexts.sources` jsonb entry, validated rather than trusted. */
interface LooseSource {
  readonly sourceId?: unknown;
  readonly type?: unknown;
  readonly content?: unknown;
  readonly contentHash?: unknown;
}

function parseSource(item: unknown): SourceCandidate | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const source = item as LooseSource;
  if (
    typeof source.sourceId !== 'string' ||
    typeof source.content !== 'string' ||
    typeof source.contentHash !== 'string' ||
    !isContextSourceType(source.type)
  ) {
    return null;
  }
  return {
    sourceId: source.sourceId,
    sourceType: source.type,
    contentHash: source.contentHash,
    content: source.content,
  };
}

/**
 * Collect the distinct current sources from persisted context snapshots
 * (newest-first) into embeddable candidates. This is the backfill's input set:
 * it deliberately reads only the snapshots Phase-1 already persisted, so it
 * reuses the existing collection safety boundary (binaries/secrets excluded)
 * rather than re-walking the repository.
 */
export async function collectIndexSources(db: DrizzleDB): Promise<SourceCandidate[]> {
  const rows = await db
    .select({ sources: contexts.sources, createdAt: contexts.created_at })
    .from(contexts)
    .orderBy(desc(contexts.created_at));

  const byId = new Map<string, SourceCandidate>();
  for (const row of rows) {
    const items = Array.isArray(row.sources) ? row.sources : [];
    for (const item of items) {
      const source = parseSource(item);
      if (source !== null && !byId.has(source.sourceId)) {
        byId.set(source.sourceId, source);
      }
    }
  }
  return [...byId.values()];
}

/** An `artifact.created` payload carries its content inline. */
export function sourceFromCreated(payload: ArtifactCreatedPayload): SourceCandidate {
  return {
    sourceId: payload.file_path,
    sourceType: ContextSourceType.File,
    contentHash: payload.content_hash,
    content: payload.content,
  };
}

/**
 * Resolve an `artifact.changed` payload back to a FILE source. The payload alone
 * carries only the new hash, so `file_path` comes from `artifacts` and the
 * content from the content-addressed `snapshots` store (latest generation).
 * Returns `null` when either is unresolvable (the artifact or snapshot is gone)
 * — the caller leaves any existing row stale so the read path never serves it.
 */
export async function resolveChangedSource(
  db: DrizzleDB,
  payload: ArtifactChangedPayload,
): Promise<SourceCandidate | null> {
  const [artifactRow] = await db
    .select({ filePath: artifacts.file_path })
    .from(artifacts)
    .where(eq(artifacts.id, payload.artifact_id))
    .limit(1);

  const filePath = artifactRow?.filePath;
  const content = await resolveSnapshotContent(db, payload.change_id);
  if (filePath === undefined || content === null) {
    return null;
  }
  return {
    sourceId: filePath,
    sourceType: ContextSourceType.File,
    contentHash: payload.content_hash,
    content,
  };
}

async function resolveSnapshotContent(db: DrizzleDB, changeId: string): Promise<string | null> {
  const rows = await db
    .select({ content: snapshots.content })
    .from(snapshots)
    .where(eq(snapshots.change_id, changeId))
    .orderBy(desc(snapshots.generation))
    .limit(1);
  return rows[0]?.content ?? null;
}
