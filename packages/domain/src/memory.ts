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
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? new Date(),
  };
}
