import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { evidence, memoryEntries, memoryEntryEvidence } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { EventType, MemoryKind, newEvidenceID, newMemoryID } from '@harness/domain';
import type { MemoryArchivedPayload, MemoryConsolidatedPayload, MemoryID } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

import {
  MemoryLifecycle,
  MemoryStore,
  applyDecay,
  archiveBelowThreshold,
  consolidateChains,
} from '../index.js';

const SCHEMA = 'harness_test_memory_lifecycle';
const NOW = new Date('2026-08-24T00:00:00Z');

/** A date `days` before the fixed clock. */
function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

let testDb: TestDb;
let db: DrizzleDB;
let bus: IEventBus;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  bus = new InProcessEventBus();
  await db.delete(memoryEntryEvidence);
  await db.delete(memoryEntries);
  await db.delete(evidence);
});

interface SeedOverrides {
  readonly id: MemoryID;
  readonly content: string;
  readonly confidence?: number;
  readonly confidenceFloor?: number;
  readonly status?: 'ACTIVE' | 'ARCHIVED';
  readonly createdAt?: Date;
  readonly lastRetrievedAt?: Date;
  readonly supersedes?: MemoryID | null;
}

/** Insert an entry + one evidence link, returning that evidence id. */
async function seedEntry(overrides: SeedOverrides): Promise<string> {
  const evidenceId = newEvidenceID();
  await db.insert(evidence).values({
    id: evidenceId,
    content_hash: `sha256:${overrides.id}`,
    kind: 'DIFF',
    body: 'recorded diff',
  });
  await db.insert(memoryEntries).values({
    id: overrides.id,
    kind: MemoryKind.REVIEW,
    content: overrides.content,
    confidence: overrides.confidence ?? 50,
    confidence_floor: overrides.confidenceFloor ?? 10,
    status: overrides.status ?? 'ACTIVE',
    created_at: overrides.createdAt,
    last_retrieved_at: overrides.lastRetrievedAt,
    supersedes: overrides.supersedes ?? null,
    metadata: {},
  });
  await db.insert(memoryEntryEvidence).values({
    id: newMemoryID(),
    memory_entry_id: overrides.id,
    evidence_id: evidenceId,
  });
  return evidenceId;
}

/** Load a single raw `memory_entries` row (non-null). */
async function entryRow(id: MemoryID): Promise<typeof memoryEntries.$inferSelect> {
  const rows = await db.select().from(memoryEntries).where(eq(memoryEntries.id, id));
  const row = rows[0];
  if (!row) {
    throw new Error(`no entry ${id}`);
  }
  return row;
}

/** The evidence-link ids on an entry, as a set for order-insensitive matching. */
async function evidenceIds(id: MemoryID): Promise<Set<string>> {
  const links = await db
    .select({ evidence_id: memoryEntryEvidence.evidence_id })
    .from(memoryEntryEvidence)
    .where(eq(memoryEntryEvidence.memory_entry_id, id));
  return new Set(links.map((link) => link.evidence_id));
}

describe('consolidateChains (day-19 §2.2)', () => {
  it('folds a multi-version chain into one head with merged evidence, archiving the rest', async () => {
    const v1 = newMemoryID();
    const v2 = newMemoryID();
    const v3 = newMemoryID();
    const ev1 = await seedEntry({ id: v1, content: 'null check', confidence: 60 });
    const ev2 = await seedEntry({ id: v2, content: 'null check', confidence: 70, supersedes: v1 });
    const ev3 = await seedEntry({ id: v3, content: 'null check', confidence: 80, supersedes: v2 });

    const seen: MemoryConsolidatedPayload[] = [];
    bus.subscribe<MemoryConsolidatedPayload>(EventType.MemoryConsolidated, (event) => {
      seen.push(event.payload);
    });

    const result = await consolidateChains(db, bus);

    expect(result.mergedChains).toBe(1);
    expect(result.archived).toBe(2);
    expect(result.foldedLinks).toBe(2);

    // The head survives ACTIVE with the chain-max confidence and all three links.
    expect((await entryRow(v3)).status).toBe('ACTIVE');
    expect((await entryRow(v3)).confidence).toBe(80);
    expect(await evidenceIds(v3)).toEqual(new Set([ev1, ev2, ev3]));

    // Superseded versions are archived (soft-delete, retained for audit).
    expect((await entryRow(v1)).status).toBe('ARCHIVED');
    expect((await entryRow(v2)).status).toBe('ARCHIVED');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.memory_id).toBe(v3);
    expect(new Set(seen[0]?.archived_ids ?? [])).toEqual(new Set([v1, v2]));
    expect(seen[0]?.evidence_count).toBe(2);
  });

  it('is a no-op for a flat, un-chained index', async () => {
    const a = newMemoryID();
    const b = newMemoryID();
    await seedEntry({ id: a, content: 'one' });
    await seedEntry({ id: b, content: 'two' });

    const result = await consolidateChains(db, bus);

    expect(result).toEqual({ mergedChains: 0, archived: 0, foldedLinks: 0 });
    expect((await entryRow(a)).status).toBe('ACTIVE');
    expect((await entryRow(b)).status).toBe('ACTIVE');
  });
});

describe('applyDecay (day-19 §2.3)', () => {
  it('tapers confidence exponentially over time', async () => {
    const id = newMemoryID();
    await seedEntry({ id, content: 'stale', confidence: 100, createdAt: daysBefore(NOW, 3) });

    const result = await applyDecay(db, { now: NOW, factorPerDay: 0.5, graceDays: 0 });

    expect(result.decayed).toBe(1);
    // 100 · 0.5^3 = 12.5 → rounds to 13 (floor 10 doesn't bind).
    expect((await entryRow(id)).confidence).toBe(13);
  });

  it('floors at the entry confidence_floor, never below it', async () => {
    const id = newMemoryID();
    await seedEntry({
      id,
      content: 'stale',
      confidence: 100,
      confidenceFloor: 50,
      createdAt: daysBefore(NOW, 3),
    });

    await applyDecay(db, { now: NOW, factorPerDay: 0.5, graceDays: 0 });

    expect((await entryRow(id)).confidence).toBe(50);
  });

  it('skips entries retrieved within the grace window', async () => {
    const id = newMemoryID();
    await seedEntry({
      id,
      content: 'fresh',
      confidence: 100,
      createdAt: daysBefore(NOW, 30),
      lastRetrievedAt: NOW,
    });

    const result = await applyDecay(db, { now: NOW, factorPerDay: 0.5, graceDays: 7 });

    expect(result.skipped).toBe(1);
    expect((await entryRow(id)).confidence).toBe(100);
  });
});

describe('archiveBelowThreshold (day-19 §2.4)', () => {
  it('archives below-threshold entries, leaves the rest, and emits memory.archived', async () => {
    const dropped = newMemoryID();
    const kept = newMemoryID();
    await seedEntry({ id: dropped, content: 'forgotten', confidence: 2 });
    await seedEntry({ id: kept, content: 'still useful', confidence: 30 });

    const seen: MemoryArchivedPayload[] = [];
    bus.subscribe<MemoryArchivedPayload>(EventType.MemoryArchived, (event) => {
      seen.push(event.payload);
    });

    const result = await archiveBelowThreshold(db, bus);

    expect(result.archived).toBe(1);
    expect((await entryRow(dropped)).status).toBe('ARCHIVED');
    expect((await entryRow(kept)).status).toBe('ACTIVE');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.memory_id).toBe(dropped);
    expect(seen[0]?.reason).toBe('below_confidence_threshold');
  });

  it('archives every below-threshold row in one pass and emits one event each', async () => {
    const a = newMemoryID();
    const b = newMemoryID();
    const c = newMemoryID();
    await seedEntry({ id: a, content: 'forgotten a', confidence: 1 });
    await seedEntry({ id: b, content: 'forgotten b', confidence: 2 });
    await seedEntry({ id: c, content: 'still useful', confidence: 30 });

    const seen: MemoryArchivedPayload[] = [];
    bus.subscribe<MemoryArchivedPayload>(EventType.MemoryArchived, (event) => {
      seen.push(event.payload);
    });

    const result = await archiveBelowThreshold(db, bus);

    expect(result.archived).toBe(2);
    expect((await entryRow(a)).status).toBe('ARCHIVED');
    expect((await entryRow(b)).status).toBe('ARCHIVED');
    expect((await entryRow(c)).status).toBe('ACTIVE');

    // One audit event per archived row — batching collapses the writes, not the provenance.
    expect(new Set(seen.map((p) => p.memory_id))).toEqual(new Set([a, b]));
    expect(seen.every((p) => p.reason === 'below_confidence_threshold')).toBe(true);
  });
});

describe('retrieval excludes archived entries (day-19 §2.4)', () => {
  it('listByKind stops surfacing ARCHIVED rows while getById retains them for audit', async () => {
    const live = newMemoryID();
    const archived = newMemoryID();
    await seedEntry({ id: live, content: 'live memory' });
    await seedEntry({ id: archived, content: 'archived memory', status: 'ARCHIVED' });

    const store = new MemoryStore(db, new InProcessEventBus());
    const listed = await store.listByKind(MemoryKind.REVIEW);

    expect(listed.map((entry) => entry.id)).toEqual([live]);

    // Audit still reaches the archived row by id.
    const byId = await store.getById(archived);
    expect(byId?.status).toBe('ARCHIVED');
  });
});

describe('MemoryLifecycle.tick (day-19 §2.1)', () => {
  it('is idempotent — a second tick consolidates nothing further', async () => {
    const lifecycle = new MemoryLifecycle(db, bus);

    const v1 = newMemoryID();
    const v2 = newMemoryID();
    await seedEntry({ id: v1, content: 'null check', confidence: 60 });
    await seedEntry({ id: v2, content: 'null check', confidence: 70, supersedes: v1 });

    const first = await lifecycle.tick({ now: NOW, factorPerDay: 0.5, graceDays: 0 });
    expect(first.consolidated.archived).toBe(1);

    const second = await lifecycle.tick({ now: NOW, factorPerDay: 0.5, graceDays: 0 });
    expect(second.consolidated.archived).toBe(0);
    expect(second.consolidated.foldedLinks).toBe(0);

    // The head is still the surviving entry with merged evidence.
    expect((await entryRow(v2)).status).toBe('ACTIVE');
  });
});
