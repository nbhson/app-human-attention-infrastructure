/**
 * Artifact change event payloads (artifact-tracker spec §2.2).
 */

import type { AgentRunID, ArtifactID, ChangeID } from '../ids.js';
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
