/**
 * `ArtifactTracker` (day-14 §2.4) — the transactional capture service and system
 * of record for AI-generated files.
 *
 * Each `artifact.created` event becomes three atomic writes inside one
 * transaction (day-14 §6):
 *
 *   1. **get-or-create the `artifacts` row** — one current-version pointer per
 *      `(project_id, file_path)`. A fresh file starts `DRAFT`; a re-write of an
 *      existing file reuses the same artifact id.
 *   2. **append an immutable `changes` row** — `PENDING`, linked to the
 *      artifact and the producing agent run, carrying the content hash. This is
 *      provenance and is never deleted.
 *   3. **content-address the bytes into `snapshots`** (deduplicated), then
 *      repoint `artifacts.current_change_id` at the new change.
 *
 * Provenance metadata only ever *accumulates*: there are no `DELETE` statements
 * in this package, so "who changed what, why" is always recoverable.
 */

import { and, eq } from 'drizzle-orm';

import {
  ArtifactStatus,
  ChangeStatus,
  FileChangeType,
  brand,
  newArtifactID,
  newChangeID,
} from '@harness/domain';
import type { AgentRunID, ArtifactID, ChangeID, ProjectID } from '@harness/domain';
import { agentRuns, artifacts, changes, tasks } from '@harness/db';
import type { DrizzleDB } from '@harness/db';

import { SnapshotStore, sha256 } from './snapshot-store.js';

/** The minimal facts needed to capture a single file write. */
export interface CaptureInput {
  /** The agent run that wrote the file. */
  readonly agentRunId: AgentRunID;
  /** The sandbox-relative path written. */
  readonly filePath: string;
  /** The full file content (snapshot source of truth). */
  readonly content: string;
}

/** The rows produced (or reused) by a capture. */
export interface CaptureResult {
  readonly artifactId: ArtifactID;
  readonly changeId: ChangeID;
}

export class ArtifactTracker {
  constructor(
    private readonly db: DrizzleDB,
    private readonly snapshots: SnapshotStore,
  ) {}

  /**
   * Record one file write. Returns `null` when the producing run (or its task)
   * cannot be resolved — the event is dropped rather than half-recorded.
   */
  async capture(input: CaptureInput): Promise<CaptureResult | null> {
    const projectId = await this.resolveProjectId(input.agentRunId);
    if (!projectId) {
      return null;
    }

    const hash = sha256(input.content);

    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(and(eq(artifacts.project_id, projectId), eq(artifacts.file_path, input.filePath)))
        .limit(1);
      const existingRow = existing[0];
      const isNew = existingRow === undefined;
      const artifactId = isNew ? newArtifactID() : brand(existingRow.id, 'ArtifactID');

      if (isNew) {
        await tx.insert(artifacts).values({
          id: artifactId,
          project_id: projectId,
          file_path: input.filePath,
          status: ArtifactStatus.Draft,
        });
      }

      const changeId = newChangeID();
      await tx.insert(changes).values({
        id: changeId,
        artifact_id: artifactId,
        agent_run_id: input.agentRunId,
        change_type: isNew ? FileChangeType.Created : FileChangeType.Modified,
        status: ChangeStatus.Pending,
        content_hash: hash,
        diff_summary: `${isNew ? 'created' : 'modified'} ${input.filePath}`,
      });

      await this.snapshots.save(tx, changeId, input.content);

      await tx
        .update(artifacts)
        .set({ current_change_id: changeId, updated_at: new Date() })
        .where(eq(artifacts.id, artifactId));

      return { artifactId, changeId };
    });
  }

  /** Resolve the run's owning project through `agent_runs → tasks → project`. */
  private async resolveProjectId(agentRunId: AgentRunID): Promise<ProjectID | null> {
    const rows = await this.db
      .select({ project_id: tasks.project_id })
      .from(agentRuns)
      .innerJoin(tasks, eq(agentRuns.task_id, tasks.id))
      .where(eq(agentRuns.id, agentRunId))
      .limit(1);
    const id = rows[0]?.project_id;
    return id ? brand(id, 'ProjectID') : null;
  }
}
