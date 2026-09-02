/**
 * Freshness checking (day-21 §2.1) — detect when a resolved snapshot has gone
 * STALE because a source file changed (or vanished) since collection.
 *
 * The per-source `contentHash` recorded at collection time is compared against a
 * fresh hash of the file on disk. The engine records the hash of the *original*
 * content (even for a budget-truncated source), so this check compares reality
 * against reality, never against the trimmed view (context-engine spec §8).
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { ContextSnapshot } from '@harness/domain';

import { resolveSafe } from './resolve-safe.js';

export type Freshness = 'FRESH' | 'STALE';

export interface FreshnessResult {
  readonly freshness: Freshness;
  /** Repo-relative paths of every source whose content no longer matches. */
  readonly staleSources: string[];
}

/** SHA-256 of `content`, hex-encoded (matches collection-time hashing). */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Hash a file inside `projectRoot`, or `null` when it cannot be read (missing or
 * a path that escapes the root). `null` is treated as stale by
 * {@link checkFreshness} — a vanished source is at least as stale as an edited one.
 */
export async function hashFile(projectRoot: string, sourceId: string): Promise<string | null> {
  try {
    const content = await readFile(resolveSafe(projectRoot, sourceId), 'utf8');
    return sha256(content);
  } catch {
    return null;
  }
}

/**
 * Compare every snapshot source against its current on-disk content. Returns
 * `FRESH` only when nothing changed; otherwise `STALE` with the offending paths.
 */
export async function checkFreshness(snapshot: ContextSnapshot, projectRoot: string): Promise<FreshnessResult> {
  const staleSources: string[] = [];
  for (const source of snapshot.sources) {
    const current = await hashFile(projectRoot, source.sourceId);
    if (current !== source.contentHash) {
      staleSources.push(source.sourceId);
    }
  }
  return { freshness: staleSources.length > 0 ? 'STALE' : 'FRESH', staleSources };
}
