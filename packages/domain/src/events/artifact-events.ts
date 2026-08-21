/**
 * Artifact change event payloads (artifact-tracker spec §2.2).
 */

import type { AgentRunID, ArtifactID, ChangeID, TaskID } from '../ids.js';
import type { FileChangeType } from '../artifact.js';

/** Payload for {@link import('./event-types.js').EventType.ArtifactChanged}. */
export interface ArtifactChangedPayload {
  /** The artifact that changed. */
  readonly artifact_id: ArtifactID;
  /** The change record. */
  readonly change_id: ChangeID;
  /** The type of edit applied. */
  readonly change_type: FileChangeType;
  /** SHA-256 of the new content. */
  readonly content_hash: string;
  /** The agent run that produced the change. */
  readonly agent_run_id: AgentRunID;
}

/** Payload for {@link import('./event-types.js').EventType.ArtifactCreated}. */
export interface ArtifactCreatedPayload {
  /** The agent run that wrote the file. */
  readonly agent_run_id: AgentRunID;
  /** The sandbox-relative path of the written file. */
  readonly file_path: string;
  /** SHA-256 of the file content. */
  readonly content_hash: string;
  /** Byte size of the file content (UTF-8). */
  readonly size_bytes: number;
  /** The full file content, so the tracker can snapshot it without re-reading disk. */
  readonly content: string;
}

/** Payload for {@link import('./event-types.js').EventType.ArtifactRollbackRequested}. */
export interface ArtifactRollbackRequestedPayload {
  /** The change to roll back. */
  readonly change_id: ChangeID;
  /** Why the rollback was requested (a human decision or a policy). */
  readonly reason: string;
}

/** Payload for {@link import('./event-types.js').EventType.ArtifactMerged}. */
export interface ArtifactMergedPayload {
  /** The task whose approved change set was merged. */
  readonly task_id: TaskID;
  /** The git commit SHA produced by the merge (post-merge source of truth). */
  readonly commit_sha: string;
}
