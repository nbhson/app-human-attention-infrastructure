/**
 * `DiffEngine` (day-17 §2.3) — on-demand unified diffs with line counts.
 *
 * The review UI (Day 23) and Attention `complexity` factor (Day 18) both need
 * the *shape* of a change, not just its hash: how many lines were added/removed,
 * and the actual hunks. Diffs are computed **on demand** from the content-addressed
 * snapshots — never persisted (no `DIFF` evidence row in Phase 1, per the Day-17
 * design note) — using the `diff` package (no git dependency, ADR Day 14).
 *
 * **Base resolution:** the schema records one `changes` row per file write, and
 * content is deduplicated into `snapshots` by SHA-256 (Day 14). The base for a
 * change is therefore the snapshot of the *previous* write to the same artifact
 * (the same `file_path`), ordered by `created_at`; a first-ever write has no
 * base and is reported `isNewFile: true`.
 */

import { and, desc, eq, lt } from 'drizzle-orm';
import { diffLines, FILE_HEADERS_ONLY, formatPatch, structuredPatch } from 'diff';

import { artifacts, changes, snapshots } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import type { ChangeID } from '@harness/domain';

/** The unified diff of one file plus the line-count stats derived from it. */
export interface FileDiff {
  /** The sandbox-relative file path. */
  readonly path: string;
  /** Unified diff text (git-style `---`/`+++`/`@@` hunks). */
  readonly hunks: string;
  /** Number of added lines. */
  readonly addedLines: number;
  /** Number of removed lines. */
  readonly removedLines: number;
  /** True when the artifact has no prior snapshot (a created file). */
  readonly isNewFile: boolean;
}

export class DiffEngine {
  constructor(private readonly db: DrizzleDB) {}

  /**
   * Compute the diff of the file written by `changeId`. Returns an empty array
   * when the change (or its artifact) cannot be resolved — the caller treats that
   * as "no diff", never as an exception.
   */
  async diffChange(changeId: ChangeID): Promise<FileDiff[]> {
    const changeRows = await this.db
      .select()
      .from(changes)
      .where(eq(changes.id, changeId))
      .limit(1);
    const change = changeRows[0];
    if (!change) {
      return [];
    }

    const artifactRows = await this.db
      .select({ file_path: artifacts.file_path })
      .from(artifacts)
      .where(eq(artifacts.id, change.artifact_id))
      .limit(1);
    const path = artifactRows[0]?.file_path ?? '';

    const base = await this.baseFor(change.artifact_id, change.created_at);
    const current = await this.contentFor(change.content_hash);

    return [this.buildDiff(path, base.content, current, base.exists)];
  }

  /** The full body of the snapshot whose SHA-256 is `hash`. */
  private async contentFor(hash: string): Promise<string> {
    const rows = await this.db
      .select({ content: snapshots.content })
      .from(snapshots)
      .where(eq(snapshots.content_hash, hash))
      .limit(1);
    return rows[0]?.content ?? '';
  }

  /** The previous write to `artifactId` (before `createdAt`), if any. */
  private async baseFor(
    artifactId: string,
    createdAt: Date,
  ): Promise<{ readonly content: string; readonly exists: boolean }> {
    const rows = await this.db
      .select({ content_hash: changes.content_hash })
      .from(changes)
      .where(and(eq(changes.artifact_id, artifactId), lt(changes.created_at, createdAt)))
      .orderBy(desc(changes.created_at))
      .limit(1);
    const hash = rows[0]?.content_hash;
    if (!hash) {
      return { content: '', exists: false };
    }
    return { content: await this.contentFor(hash), exists: true };
  }

  /** Build one {@link FileDiff} from base/current content. */
  private buildDiff(path: string, base: string, current: string, exists: boolean): FileDiff {
    const changesLines = diffLines(base, current);
    const addedLines = changesLines.reduce(
      (sum, change) => sum + (change.added ? change.count : 0),
      0,
    );
    const removedLines = changesLines.reduce(
      (sum, change) => sum + (change.removed ? change.count : 0),
      0,
    );
    const patch = structuredPatch(path, path, base, current, '', '', { context: 3 });
    return {
      path,
      hunks: formatPatch(patch, FILE_HEADERS_ONLY),
      addedLines,
      removedLines,
      isNewFile: !exists,
    };
  }
}
