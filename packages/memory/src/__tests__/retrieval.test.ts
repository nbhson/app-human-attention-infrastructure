import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { evidence, memoryEntries, memoryEntryEvidence } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { MemoryKind, newEvidenceID, newMemoryID, createMemoryEntry } from '@harness/domain';
import type { MemoryEntry, MemoryID } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';

import { MemoryRetriever, MemoryStore, resolveChainHeads } from '../index.js';

const SCHEMA = 'harness_test_memory_retrieval';
const NOW = new Date('2026-08-24T00:00:00Z');

/** A date `days` before the fixed retrieval clock (deterministic recency). */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

let testDb: TestDb;
let db: DrizzleDB;
let store: MemoryStore;

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  store = new MemoryStore(db, new InProcessEventBus());
  await db.delete(memoryEntryEvidence);
  await db.delete(memoryEntries);
  await db.delete(evidence);
});

interface SeedOverrides {
  readonly kind?: MemoryEntry['kind'];
  readonly content: string;
  readonly confidence?: number;
  readonly retrievedCount?: number;
  readonly createdAt?: Date;
  readonly supersedes?: MemoryID | null;
}

/** Insert an entry plus its (≥1) evidence link so `listByKind` will surface it. */
async function seedEntry(overrides: SeedOverrides & { readonly id: MemoryID }): Promise<void> {
  const evidenceId = newEvidenceID();
  await db.insert(evidence).values({
    id: evidenceId,
    content_hash: `sha256:${overrides.id}`,
    kind: 'DIFF',
    body: 'recorded diff',
  });
  await db.insert(memoryEntries).values({
    id: overrides.id,
    kind: overrides.kind ?? MemoryKind.REVIEW,
    content: overrides.content,
    confidence: overrides.confidence ?? 50,
    retrieved_count: overrides.retrievedCount ?? 0,
    created_at: overrides.createdAt,
    supersedes: overrides.supersedes ?? null,
    metadata: {},
  });
  await db.insert(memoryEntryEvidence).values({
    id: newMemoryID(),
    memory_entry_id: overrides.id,
    evidence_id: evidenceId,
  });
}

/** Build a synthetic `MemoryEntry` for the pure head-resolution test. */
function mkEntry(id: MemoryID, supersedes: MemoryID | null): MemoryEntry {
  return createMemoryEntry({
    id,
    kind: MemoryKind.REVIEW,
    content: 'x',
    sourceEvidence: [newEvidenceID()],
    supersedes,
  });
}

/** Poll a predicate until true (the access-tracking write is fire-and-forget). */
async function waitFor(predicate: () => Promise<boolean>, timeout = 4_000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for async write');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('resolveChainHeads (day-18 §2.2)', () => {
  it('keeps only the head of each supersede chain and untouched standalones', () => {
    const v1 = mkEntry(newMemoryID(), null);
    const v2 = mkEntry(newMemoryID(), v1.id);
    const v3 = mkEntry(newMemoryID(), v2.id);
    const standalone = mkEntry(newMemoryID(), null);

    const heads = resolveChainHeads([v1, v2, v3, standalone]);
    expect(new Set(heads.map((e) => e.id))).toEqual(new Set([v3.id, standalone.id]));
  });
});

describe('MemoryRetriever (day-18 §2.1 §3.1)', () => {
  it('ranks a lexical, popular, fresh entry above a cold irrelevant one', async () => {
    const hot = newMemoryID();
    const cold = newMemoryID();
    await seedEntry({
      id: hot,
      content: 'payload dereference needs a null check guard',
      confidence: 90,
      retrievedCount: 3,
      createdAt: daysAgo(1),
    });
    await seedEntry({
      id: cold,
      content: 'unrelated widget rendering',
      confidence: 20,
      createdAt: daysAgo(100),
    });

    const results = await new MemoryRetriever(store, () => NOW).retrieve({
      text: 'null check payload',
    });
    expect(results.map((r) => r.entry.id)).toEqual([hot, cold]);
    expect(results[0]?.relevance).toBeGreaterThan(results[1]?.relevance ?? 0);
  });

  it('confidence decides between otherwise-equal entries', async () => {
    const high = newMemoryID();
    const low = newMemoryID();
    await seedEntry({ id: high, content: 'null check', confidence: 90, createdAt: daysAgo(1) });
    await seedEntry({ id: low, content: 'null check', confidence: 10, createdAt: daysAgo(1) });

    const results = await new MemoryRetriever(store, () => NOW).retrieve({
      text: 'null check',
      kinds: [MemoryKind.REVIEW],
    });
    expect(results.map((r) => r.entry.id)).toEqual([high, low]);
  });

  it('recency decides between otherwise-equal entries', async () => {
    const fresh = newMemoryID();
    const stale = newMemoryID();
    await seedEntry({ id: fresh, content: 'null check', createdAt: daysAgo(1) });
    await seedEntry({ id: stale, content: 'null check', createdAt: daysAgo(100) });

    const results = await new MemoryRetriever(store, () => NOW).retrieve({
      text: 'null check',
    });
    expect(results.map((r) => r.entry.id)).toEqual([fresh, stale]);
  });

  it('returns only the head of a supersede chain', async () => {
    const v1 = newMemoryID();
    const v2 = newMemoryID();
    await seedEntry({ id: v1, content: 'null check on payload', confidence: 70 });
    await seedEntry({ id: v2, content: 'null check on payload', confidence: 80, supersedes: v1 });

    const results = await new MemoryRetriever(store, () => NOW).retrieve({
      text: 'null check',
    });
    expect(results.map((r) => r.entry.id)).toEqual([v2]);
  });

  it('bumps retrievedCount and lastRetrievedAt after serve (fire-and-forget)', async () => {
    const id = newMemoryID();
    await seedEntry({ id, content: 'null check on payload', retrievedCount: 2 });

    await new MemoryRetriever(store, () => NOW).retrieve({ text: 'null check' });

    await waitFor(async () => {
      const entry = await store.getById(id);
      return entry !== null && entry.retrievedCount === 3 && entry.lastRetrievedAt !== null;
    });
  });
});
