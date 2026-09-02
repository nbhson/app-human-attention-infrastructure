/**
 * Context domain types.
 *
 * The Context Engine selects, ranks, compresses, and delivers context to AI
 * Agents. Source: `4_Context_Engine_v0.2.md` (§2). These types define the
 * snapshot the agent consumes and the policy that shapes it.
 */

import type { ContextID, ProjectID, TaskID } from './ids.js';

/** The provenance category of a context source (context-engine spec §2.2, §5.1). */
export const ContextSourceType = {
  File: 'FILE',
  Symbol: 'SYMBOL',
  GitHistory: 'GIT_HISTORY',
  Documentation: 'DOCUMENTATION',
  Architecture: 'ARCHITECTURE',
  Test: 'TEST',
  Decision: 'DECISION',
  Evidence: 'EVIDENCE',
} as const;
/** A context source category. */
export type ContextSourceType = (typeof ContextSourceType)[keyof typeof ContextSourceType];

/** Context compression strategies (context-engine spec §2.3, §6). */
export const CompressionStrategy = {
  None: 'NONE',
  Truncate: 'TRUNCATE',
  Summarize: 'SUMMARIZE',
  Hybrid: 'HYBRID',
} as const;
/** A compression strategy. */
export type CompressionStrategy = (typeof CompressionStrategy)[keyof typeof CompressionStrategy];

/**
 * A single resolved context source (context-engine spec §2.2).
 */
export interface ContextSource {
  /** The source category. */
  readonly type: ContextSourceType;
  /** An identifier for the source (e.g. a file path or symbol). */
  readonly sourceId: string;
  /** Relevance score in `[0, 1]`. */
  readonly relevanceScore: number;
  /** The actual content delivered to the agent. */
  readonly content: string;
  /** Token count of `content`. */
  readonly tokenCount: number;
  /** SHA-256 of the content at collection time (freshness, §8). */
  readonly contentHash: string;
  /** Free-form source metadata. */
  readonly metadata: Record<string, unknown>;
}

/**
 * The packaged context handed to the Agent Runtime (context-engine §2.2).
 *
 * A snapshot is a point-in-time view; it must reflect the actual resolution a
 * task consumed (never cached), so the trajectory/provenance record is accurate.
 */
export interface ContextSnapshot {
  /** Unique snapshot id. */
  readonly id: ContextID;
  /** The task this context was prepared for. */
  readonly taskId: TaskID;
  /** Creation time. */
  readonly createdAt: Date;
  /** The ordered list of included sources. */
  readonly sources: ContextSource[];
  /** Total tokens across all sources. */
  readonly totalTokens: number;
  /** The ranking method used. */
  readonly rankMethod: string;
  /** Optional compressed summary. */
  readonly summary?: string;
  /** Free-form snapshot metadata (e.g. re-ranked order, §5.1). */
  readonly metadata: Record<string, unknown>;
}

/** A repository reference (context-engine spec §2.1, §9). */
export interface RepositoryRef {
  readonly owner: string;
  readonly name: string;
  readonly branch: string;
}

/**
 * A request to resolve context for a task (context-engine spec §2.1).
 */
export interface ContextRequest {
  /** The task to resolve context for. */
  readonly taskId: TaskID;
  /** The task description used for ranking. */
  readonly taskDescription: string;
  /** The developer's requirements. */
  readonly requirements: string;
  /** The owning project. */
  readonly projectId: ProjectID;
  /** The repository to scan. */
  readonly repository: RepositoryRef;
  /** Files explicitly mentioned in the task. */
  readonly targetFiles: string[];
  /** A prior snapshot to build on. */
  readonly previousContextId?: ContextID;
  /** The token budget for the context window. */
  readonly maxTokens: number;
  /** Optional policy override. */
  readonly policy?: ContextPolicy;
}

/**
 * The policy shaping context resolution (context-engine spec §2.3).
 */
export interface ContextPolicy {
  /** Max sources to include. */
  readonly maxSources: number;
  /** Max tokens per source. */
  readonly maxTokensPerSource: number;
  /** Minimum relevance to include a source (`[0, 1]`). */
  readonly minRelevanceThreshold: number;
  /** Compression strategy. */
  readonly compressionStrategy: CompressionStrategy;
  /** Include git history sources. */
  readonly includeGitHistory: boolean;
  /** Include architecture sources. */
  readonly includeArchitecture: boolean;
  /** Include previous human decisions. */
  readonly includePreviousDecisions: boolean;
  /** Include runtime evidence. */
  readonly includeRuntimeEvidence: boolean;
}

/** Input for {@link createContextSource}. */
export type CreateContextSourceInput = Omit<ContextSource, 'metadata'> & Partial<Pick<ContextSource, 'metadata'>>;

/**
 * Build a {@link ContextSource} defaulting `metadata` to an empty object.
 */
export function createContextSource(input: CreateContextSourceInput): ContextSource {
  return { metadata: {}, ...input };
}

/** Input for {@link createContextSnapshot}. */
export type CreateContextSnapshotInput = Omit<ContextSnapshot, 'createdAt' | 'metadata'> &
  Partial<Pick<ContextSnapshot, 'createdAt' | 'metadata' | 'summary'>>;

/**
 * Build a {@link ContextSnapshot} defaulting `createdAt` to now and `metadata`
 * to an empty object.
 */
export function createContextSnapshot(input: CreateContextSnapshotInput): ContextSnapshot {
  return { createdAt: new Date(), metadata: {}, ...input };
}
