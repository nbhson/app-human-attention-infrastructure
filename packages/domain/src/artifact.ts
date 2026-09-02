/**
 * Artifact and Change domain types.
 *
 * The Artifact/Change Tracker is the system of record for AI-generated outputs
 * and the provenance of every change. Source: `5_Artifact_Change_Tracker_v0.1.md`
 * (§2, §3). These types carry the provenance chain that answers "who changed what,
 * why, using which model, based on which context, with what evidence?".
 */

import type {
  AgentRunID,
  ArtifactID,
  AssessmentID,
  ChangeID,
  ContextID,
  DecisionID,
  SnapshotID,
  TaskID,
  VerificationResultID,
} from './ids.js';

/** The kind of tracked artifact (artifact-tracker spec §2.1). */
export const ArtifactType = {
  File: 'FILE',
  CodeBlock: 'CODE_BLOCK',
  Test: 'TEST',
  Documentation: 'DOCUMENTATION',
  Configuration: 'CONFIGURATION',
  ArchitectureDecision: 'ARCHITECTURE_DECISION',
  Other: 'OTHER',
} as const;
/** An artifact kind. */
export type ArtifactType = (typeof ArtifactType)[keyof typeof ArtifactType];

/** Artifact lifecycle states (artifact-tracker spec §2.1, §3). */
export const ArtifactStatus = {
  Draft: 'DRAFT',
  PendingReview: 'PENDING_REVIEW',
  Approved: 'APPROVED',
  Rejected: 'REJECTED',
  Superseded: 'SUPERSEDED',
  Merged: 'MERGED',
} as const;
/** An artifact lifecycle status. */
export type ArtifactStatus = (typeof ArtifactStatus)[keyof typeof ArtifactStatus];

/** Change statuses — event-driven, not set manually (artifact-tracker §2.2). */
export const ChangeStatus = {
  Pending: 'PENDING',
  Verified: 'VERIFIED',
  Reviewed: 'REVIEWED',
  RolledBack: 'ROLLED_BACK',
} as const;
/** A change status. */
export type ChangeStatus = (typeof ChangeStatus)[keyof typeof ChangeStatus];

/** The type of edit applied to a single file (artifact-tracker §2.2). */
export const FileChangeType = {
  Created: 'CREATED',
  Modified: 'MODIFIED',
  Deleted: 'DELETED',
  Renamed: 'RENAMED',
} as const;
/** A file-change type. */
export type FileChangeType = (typeof FileChangeType)[keyof typeof FileChangeType];

/**
 * A tracked AI-generated artifact (artifact-tracker spec §2.1).
 */
export interface Artifact {
  /** Unique artifact id. */
  readonly id: ArtifactID;
  /** The artifact kind. */
  readonly type: ArtifactType;
  /** Display name. */
  readonly name: string;
  /** Relative path in the repository. */
  readonly path: string;
  /** Full content, or a reference to the content store. */
  readonly content: string;
  /** SHA-256 of `content` (deduplication + integrity). */
  readonly contentHash: string;
  /** Programming language, if applicable. */
  readonly language?: string;
  /** Byte size of `content`. */
  readonly sizeBytes: number;
  /** Lifecycle status. */
  readonly status: ArtifactStatus;
  /** Creation time. */
  readonly createdAt: Date;
  /** Last update time. */
  readonly updatedAt: Date;
  /** The artifact that replaced this one, if superseded. */
  readonly supersededBy?: ArtifactID;
  /** Free-form extension metadata. */
  readonly metadata: Record<string, unknown>;
}

/**
 * A change to one file (artifact-tracker spec §2.2).
 */
export interface FileChange {
  /** Relative file path. */
  readonly filePath: string;
  /** The edit type. */
  readonly changeType: FileChangeType;
  /** SHA-256 of previous content (absent for `CREATED`). */
  readonly beforeHash?: string;
  /** SHA-256 of new content. */
  readonly afterHash: string;
  /** Unified diff. */
  readonly diff: string;
  /** Lines added. */
  readonly linesAdded: number;
  /** Lines removed. */
  readonly linesRemoved: number;
}

/**
 * A set of file modifications made by an agent run (artifact-tracker §2.2).
 */
export interface Change {
  /** Unique change id. */
  readonly id: ChangeID;
  /** The task this change was made for. */
  readonly taskId: TaskID;
  /** The agent run that produced it. */
  readonly agentRunId: AgentRunID;
  /** The model used, e.g. `"claude-sonnet-5"`. */
  readonly modelUsed: string;
  /** When the change was recorded. */
  readonly timestamp: Date;
  /** The context snapshot used during generation. */
  readonly sourceContextId?: ContextID;
  /** Files affected. */
  readonly filesAffected: FileChange[];
  /** The agent's stated reason for the change. */
  readonly reason: string;
  /** Verification results linked to this change. */
  readonly verificationResults: VerificationResultID[];
  /** The human decision, if reviewed. */
  readonly humanDecision?: DecisionID;
  /** The risk/attention assessment, if evaluated. */
  readonly riskAssessment?: AssessmentID;
  /** Current status. */
  readonly status: ChangeStatus;
}

/**
 * A point-in-time view of artifacts and changes (artifact-tracker §2.3).
 */
export interface ArtifactSnapshot {
  /** Unique snapshot id. */
  readonly id: SnapshotID;
  /** When the snapshot was taken. */
  readonly timestamp: Date;
  /** The task the snapshot belongs to. */
  readonly taskId: TaskID;
  /** Artifacts included. */
  readonly artifacts: ArtifactID[];
  /** Changes included. */
  readonly changes: ChangeID[];
  /** Total files changed. */
  readonly totalFilesChanged: number;
  /** Total lines added. */
  readonly totalLinesAdded: number;
  /** Total lines removed. */
  readonly totalLinesRemoved: number;
  /** AI-generated summary of changes. */
  readonly summary: string;
}

/** Input for {@link createArtifact}. Derived fields are optional. */
export type CreateArtifactInput = Omit<Artifact, 'createdAt' | 'updatedAt' | 'status' | 'sizeBytes' | 'metadata'> &
  Partial<Pick<Artifact, 'createdAt' | 'updatedAt' | 'status' | 'sizeBytes' | 'metadata'>>;

/**
 * Build an {@link Artifact} defaulting status to `DRAFT`, timestamps to now,
 * `sizeBytes` to `content.length`, and `metadata` to `{}`.
 */
export function createArtifact(input: CreateArtifactInput): Artifact {
  const now = new Date();
  const { createdAt, updatedAt, status, sizeBytes, metadata, ...rest } = input;
  return {
    ...rest,
    status: status ?? ArtifactStatus.Draft,
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now,
    sizeBytes: sizeBytes ?? rest.content.length,
    metadata: metadata ?? {},
  };
}

/** Input for {@link createChange}. */
export type CreateChangeInput = Omit<Change, 'timestamp' | 'status' | 'verificationResults'> &
  Partial<Pick<Change, 'timestamp' | 'status' | 'verificationResults'>>;

/**
 * Build a {@link Change} defaulting status to `PENDING` and timestamp to now.
 */
export function createChange(input: CreateChangeInput): Change {
  return {
    timestamp: new Date(),
    status: ChangeStatus.Pending,
    verificationResults: [],
    ...input,
  };
}
