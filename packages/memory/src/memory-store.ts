/**
 * `MemoryStore` (review-reorient Phase 3, day-16 §2 §3.4) — curated review memory
 * with evidence provenance.
 *
 * `create` is the only write here and enforces the day-16 §2.3 invariant: an
 * entry cannot exist without ≥1 `sourceEvidence` link. The write is a single
 * transaction (entry row + its evidence links), then the `memory.entry_created`
 * event is published so Context/Attention subscribers can fan in. Reads
 * (`getById`/`listByKind`) re-load the links and filter out any entry that some
 * external writer left link-less, so the invariant also holds on the way out.
 *
 * Boundary (day-16 §2.4, R16): `@harness/memory` imports only `@harness/domain`,
 * `@harness/event-bus`, `@harness/db`, and `@harness/di` — it is *consumed by*
 * context/attention via the event bus, never by a sibling engine importing it.
 */

import { eq, and, inArray, desc, sql } from 'drizzle-orm';

import { memoryEntries, memoryEntryEvidence } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import {
  brand,
  createMemoryEntry,
  DEFAULT_CONFIDENCE_FLOOR,
  EventType,
  MemoryStatus,
  newMemoryID,
  uuidv7,
} from '@harness/domain';
import type {
  MemoryEntry,
  MemoryID,
  MemoryKind,
  MemoryStatus as MemoryStatusType,
} from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';
import type { Logger } from '@harness/di';

import { EmptySourceEvidenceError } from './types.js';
import type { CreateMemoryInput } from './types.js';

/** The row shape `memory_entries` selects back (drizzle-infers it). */
type MemoryEntryRow = typeof memoryEntries.$inferSelect;

/** Map a row + its evidence-link ids onto the domain model. */
function toEntry(row: MemoryEntryRow, evidenceIds: readonly string[]): MemoryEntry {
  return {
    id: brand(row.id, 'MemoryID'),
    kind: row.kind as MemoryKind,
    content: row.content,
    sourceEvidence: evidenceIds.map((id) => brand(id, 'EvidenceID')),
    confidence: row.confidence,
    retrievedCount: row.retrieved_count,
    lastRetrievedAt: row.last_retrieved_at,
    expiresAt: row.expires_at,
    supersedes: row.supersedes === null ? null : brand(row.supersedes, 'MemoryID'),
    status: row.status as MemoryStatusType,
    confidenceFloor: row.confidence_floor,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export class MemoryStore {
  constructor(
    private readonly db: DrizzleDB,
    private readonly bus: IEventBus,
    private readonly logger?: Logger,
  ) {}

  /**
   * Write an entry and its evidence links atomically, then publish
   * `memory.entry_created` (day-16 §3.4). An empty `sourceEvidence` throws
   * {@link EmptySourceEvidenceError} — the ≥1 provenance invariant.
   */
  async create(input: CreateMemoryInput): Promise<MemoryEntry> {
    if (input.sourceEvidence.length === 0) {
      throw new EmptySourceEvidenceError();
    }

    const id = newMemoryID();
    const createdAt = new Date();

    await this.db.transaction(async (tx) => {
      await tx.insert(memoryEntries).values({
        id,
        kind: input.kind,
        content: input.content,
        confidence: input.confidence ?? 0,
        expires_at: input.expiresAt ?? null,
        supersedes: input.supersedes ?? null,
        status: input.status ?? MemoryStatus.ACTIVE,
        confidence_floor: input.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR,
        metadata: input.metadata ?? {},
      });
      await tx.insert(memoryEntryEvidence).values(
        input.sourceEvidence.map((evidenceId) => ({
          id: uuidv7(),
          memory_entry_id: id,
          evidence_id: evidenceId,
        })),
      );
    });

    this.bus.publish(
      createEvent(EventType.MemoryEntryCreated, brand(id, 'CorrelationID'), {
        memory_id: id,
        kind: input.kind,
        evidence_count: input.sourceEvidence.length,
        task_id: input.taskId ?? null,
      }),
    );
    this.logger?.debug('memory: entry created', { memory_id: id, kind: input.kind });

    return createMemoryEntry({
      id,
      kind: input.kind,
      content: input.content,
      sourceEvidence: input.sourceEvidence,
      confidence: input.confidence ?? 0,
      expiresAt: input.expiresAt ?? null,
      supersedes: input.supersedes ?? null,
      status: input.status ?? MemoryStatus.ACTIVE,
      confidenceFloor: input.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR,
      metadata: input.metadata ?? {},
      createdAt,
    });
  }

  /** Load one entry by id, with its evidence links (or `null` absent/link-less). */
  async getById(id: MemoryID): Promise<MemoryEntry | null> {
    const rows = await this.db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const links = await this.linkEvidenceFor([id]);
    const evidenceIds = links.get(id) ?? [];
    if (evidenceIds.length === 0) {
      return null; // invariant: an entry without provenance is filtered, never returned
    }
    return toEntry(row, evidenceIds);
  }

  /** All entries of one tier, newest first, filtered to active link-bearing entries. */
  async listByKind(kind: MemoryKind): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(memoryEntries)
      .where(and(eq(memoryEntries.kind, kind), eq(memoryEntries.status, 'ACTIVE')))
      .orderBy(desc(memoryEntries.created_at));
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((row) => row.id);
    const links = await this.linkEvidenceFor(ids);
    return rows
      .map((row) => toEntry(row, links.get(row.id) ?? []))
      .filter((entry) => entry.sourceEvidence.length > 0);
  }

  /**
   * Record a retrieval of this entry (day-18 §2.4): bump the access counter and
   * stamp the timestamp. Called fire-and-forget by the retriever after the result
   * is served, so the hot read path never waits on this write.
   */
  async recordAccess(id: MemoryID): Promise<void> {
    await this.db
      .update(memoryEntries)
      .set({
        retrieved_count: sql`${memoryEntries.retrieved_count} + 1`,
        last_retrieved_at: new Date(),
      })
      .where(eq(memoryEntries.id, id));
  }

  /** Evidence-link ids grouped by entry id, for a batch of entries. */
  private async linkEvidenceFor(entryIds: readonly string[]): Promise<Map<string, string[]>> {
    const links = await this.db
      .select({
        memory_entry_id: memoryEntryEvidence.memory_entry_id,
        evidence_id: memoryEntryEvidence.evidence_id,
      })
      .from(memoryEntryEvidence)
      .where(inArray(memoryEntryEvidence.memory_entry_id, [...entryIds]));
    const map = new Map<string, string[]>();
    for (const link of links) {
      const list = map.get(link.memory_entry_id) ?? [];
      list.push(link.evidence_id);
      map.set(link.memory_entry_id, list);
    }
    return map;
  }
}
