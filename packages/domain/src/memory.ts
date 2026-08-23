/**
 * Review-memory domain model (review-reorient Phase 3, day-16 §2).
 *
 * Memory here is **past reviews, findings, and decisions** — distilled,
 * searchable context for the *next* review, never code-generation state. The four
 * review-shaped tiers are the single discriminator on one `memory_entries` table
 * (a per-tier split would turn every relevance query into a special case).
 *
 * {@link MemoryEntry} is a *curated summary* (`content`) plus its provenance: the
 * evidence rows that produced it, a confidence, retrieval counters, and the
 * `supersedes` version-chain field that Day 17's versioned append will fill.
 */

import { newMemoryID } from './ids.js';
import type { EvidenceID, MemoryID } from './ids.js';

/** The four review-shaped memory tiers (day-16 §2.1, Spec 9 §3–§4). */
export const MemoryKind = {
  /** A distilled past review — what changed, what was flagged, the outcome. */
  REVIEW: 'REVIEW',
  /** A recurring review finding — a defect pattern, its severity, how often seen. */
  FINDING: 'FINDING',
  /** A human decision + rationale — approve/reject + why, reusable guidance. */
  DECISION: 'DECISION',
  /** Durable project context — conventions, risk hotspots, owners. */
  PROJECT: 'PROJECT',
} as const;
/** A review-memory tier. */
export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

/**
 * The lifecycle status of a memory entry (review-reorient Phase 3, day-19 §2.4).
 * `ARCHIVED` is a soft-delete — the row is retained for audit and excluded only
 * from retrieval, never hard-deleted.
 */
export const MemoryStatus = {
  /** Retrievable, in the active index. */
  ACTIVE: 'ACTIVE',
  /** Superseded or decayed below threshold — audit-only, excluded from retrieval. */
  ARCHIVED: 'ARCHIVED',
} as const;
/** A memory-entry lifecycle status. */
export type MemoryStatus = (typeof MemoryStatus)[keyof typeof MemoryStatus];

/**
 * The floor confidence never decays below (day-19 §2.3). Kept positive and on
 * the entry so decay flattens into "forgotten but recoverable", never deletion.
 */
export const DEFAULT_CONFIDENCE_FLOOR = 10;

/**
 * One memory entry — the curated, searchable unit of review memory.
 *
 * `content` is distilled, never a raw log/diff (Day 17 owns that distillation).
 * `sourceEvidence` links back to the evidence rows that produced the entry and is
 * non-empty by invariant (day-16 §2.3). `supersedes` forms the version chain:
 * `null` is a chain head, a non-null id points at the version this one replaces.
 */
export interface MemoryEntry {
  /** Unique entry id. */
  readonly id: MemoryID;
  /** The tier. */
  readonly kind: MemoryKind;
  /** The curated, searchable summary. */
  readonly content: string;
  /** The evidence rows that produced this entry (≥1, non-empty by invariant). */
  readonly sourceEvidence: readonly EvidenceID[];
  /** Confidence in the entry (0–100). */
  readonly confidence: number;
  /** How many times this entry has been retrieved (relevance signal). */
  readonly retrievedCount: number;
  /** When the entry was last retrieved, or `null` never. */
  readonly lastRetrievedAt: Date | null;
  /** Expiry, or `null` for a durable entry. */
  readonly expiresAt: Date | null;
  /** The version this entry supersedes, or `null` for a chain head. */
  readonly supersedes: MemoryID | null;
  /** Lifecycle status — archived entries are audit-only (day-19 §2.4). */
  readonly status: MemoryStatus;
  /** The floor confidence never decays below (day-19 §2.3). */
  readonly confidenceFloor: number;
  /** Kind-specific fields (e.g. finding severity, decision verdict). */
  readonly metadata: Record<string, unknown>;
  /** When the entry was written. */
  readonly createdAt: Date;
}

/** Input for {@link createMemoryEntry}. */
export interface CreateMemoryEntryInput {
  readonly kind: MemoryKind;
  readonly content: string;
  readonly sourceEvidence: readonly EvidenceID[];
  readonly confidence?: number;
  readonly retrievedCount?: number;
  readonly lastRetrievedAt?: Date | null;
  readonly expiresAt?: Date | null;
  readonly supersedes?: MemoryID | null;
  readonly status?: MemoryStatus;
  readonly confidenceFloor?: number;
  readonly metadata?: Record<string, unknown>;
  readonly id?: MemoryID;
  readonly createdAt?: Date;
}

/**
 * Build a {@link MemoryEntry}, defaulting `id` to a fresh UUIDv7, `createdAt` to
 * now, counters/confidence to 0, and the nullable lifecycle fields to `null`.
 */
export function createMemoryEntry(input: CreateMemoryEntryInput): MemoryEntry {
  return {
    id: input.id ?? newMemoryID(),
    kind: input.kind,
    content: input.content,
    sourceEvidence: input.sourceEvidence,
    confidence: input.confidence ?? 0,
    retrievedCount: input.retrievedCount ?? 0,
    lastRetrievedAt: input.lastRetrievedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    supersedes: input.supersedes ?? null,
    status: input.status ?? MemoryStatus.ACTIVE,
    confidenceFloor: input.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? new Date(),
  };
}

/**
 * A retrieval request (day-18 §2.1). `text` is the reviewer's query — the PR
 * title + diff summary + ticket requirement — fed to the lexical recall step.
 */
export interface MemoryQuery {
  /** Free-text query. Empty/whitespace is legal: ranking degrades to recency+confidence. */
  readonly text: string;
  /** Max entries returned, defaulting to a caller-side top-K. */
  readonly limit?: number;
  /** Restrict to these tiers; all four when omitted or empty. */
  readonly kinds?: readonly MemoryKind[];
}

/**
 * One retrieved entry plus its relevance score (day-18 §2.1). `relevance` is in
 * `[0, 1]` and is the *output* of the retriever's rank — never stored on the
 * entry itself (scoring is query-dependent).
 */
export interface MemoryRetrievalResult {
  readonly entry: MemoryEntry;
  readonly relevance: number;
}

/**
 * The review-memory provider seam (day-18 §2.3). Engines read top-K memory
 * through this contract — never by importing `@harness/memory` — so the concrete
 * retriever (lexical today, semantic-shadow later) stays swappable behind DI.
 */
export interface MemoryProvider {
  /** Return relevance-ordered, head-of-chain memory for `query`. */
  retrieve(query: MemoryQuery): Promise<readonly MemoryRetrievalResult[]>;
}
