import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { evidence, memoryEntries, memoryEntryEvidence } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { createTestDb, destroyTestDb, type TestDb } from '@harness/db/test-utils';
import { EventType, MemoryKind, newEvidenceID, newMemoryID } from '@harness/domain';
import type { EvidenceID, MemoryEntryCreatedPayload } from '@harness/domain';
import { InProcessEventBus } from '@harness/event-bus';

import { EmptySourceEvidenceError, MemoryStore } from '../index.js';

const SCHEMA = 'harness_test_memory_store';

let testDb: TestDb;
let db: DrizzleDB;
let bus: InProcessEventBus;
let store: MemoryStore;
const published: MemoryEntryCreatedPayload[] = [];

beforeAll(async () => {
  testDb = await createTestDb(SCHEMA);
  db = testDb.db;
  bus = new InProcessEventBus();
  bus.subscribe<MemoryEntryCreatedPayload>(EventType.MemoryEntryCreated, (event) =>
    published.push(event.payload),
  );
  store = new MemoryStore(db, bus);
});

afterAll(async () => {
  await destroyTestDb(testDb, SCHEMA);
});

beforeEach(async () => {
  published.length = 0;
  await db.delete(memoryEntryEvidence);
  await db.delete(memoryEntries);
  await db.delete(evidence);
});

/** Insert an evidence row and return its id, so memory links have a real FK target. */
async function seedEvidence(): Promise<EvidenceID> {
  const id = newEvidenceID();
  await db.insert(evidence).values({
    id,
    content_hash: 'sha256:deadbeef',
    kind: 'DIFF',
    body: 'a recorded diff',
  });
  return id;
}

describe('MemoryStore (day-16 §3.4)', () => {
  it('persists an entry + evidence links and returns the domain model', async () => {
    const evidenceId = await seedEvidence();

    const created = await store.create({
      kind: MemoryKind.REVIEW,
      content: 'PR #42: missing null-guard on the parsed payload',
      sourceEvidence: [evidenceId],
      confidence: 90,
    });

    expect(created.kind).toBe(MemoryKind.REVIEW);
    expect(created.sourceEvidence).toEqual([evidenceId]);
    expect(created.confidence).toBe(90);
    expect(created.retrievedCount).toBe(0);
    expect(created.supersedes).toBeNull();

    const rows = await db.select().from(memoryEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('REVIEW');

    const links = await db.select().from(memoryEntryEvidence);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ memory_entry_id: created.id, evidence_id: evidenceId });
  });

  it('rejects an empty sourceEvidence set (the ≥1 provenance invariant)', async () => {
    await expect(
      store.create({ kind: MemoryKind.REVIEW, content: 'unproven', sourceEvidence: [] }),
    ).rejects.toBeInstanceOf(EmptySourceEvidenceError);

    expect(await db.select().from(memoryEntries)).toHaveLength(0);
  });

  it('getById returns the entry with its links, and null when absent', async () => {
    const evidenceId = await seedEvidence();
    const created = await store.create({
      kind: MemoryKind.FINDING,
      content: 'recurring dynamic-import gap',
      sourceEvidence: [evidenceId],
    });

    const found = await store.getById(created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.sourceEvidence).toEqual([evidenceId]);

    await expect(store.getById(newMemoryID())).resolves.toBeNull();
  });

  it('listByKind returns only that tier, newest first', async () => {
    const e1 = await seedEvidence();
    const e2 = await seedEvidence();
    const older = await store.create({
      kind: MemoryKind.PROJECT,
      content: 'convention: no console.log outside scripts',
      sourceEvidence: [e1],
    });
    const newer = await store.create({
      kind: MemoryKind.PROJECT,
      content: 'hotspot: apps/api/src/bootstrap.ts',
      sourceEvidence: [e2],
    });
    await store.create({
      kind: MemoryKind.DECISION,
      content: 'approve only after a passing verify',
      sourceEvidence: [e1],
    });

    const projects = await store.listByKind(MemoryKind.PROJECT);
    expect(projects.map((entry) => entry.id)).toEqual([newer.id, older.id]);
    expect(projects.every((entry) => entry.kind === MemoryKind.PROJECT)).toBe(true);
  });

  it('publishes memory.entry_created with kind + id + evidence count', async () => {
    const evidenceId = await seedEvidence();
    const created = await store.create({
      kind: MemoryKind.DECISION,
      content: 'reject: rationale missing',
      sourceEvidence: [evidenceId],
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.memory_id).toBe(created.id);
    expect(published[0]?.kind).toBe(MemoryKind.DECISION);
    expect(published[0]?.evidence_count).toBe(1);
    expect(published[0]?.task_id).toBeNull();
  });

  it('writes one link row per source evidence for a multi-evidence entry', async () => {
    const e1 = await seedEvidence();
    const e2 = await seedEvidence();
    const created = await store.create({
      kind: MemoryKind.REVIEW,
      content: 'two pieces of proof',
      sourceEvidence: [e1, e2],
    });

    const links = await db.select().from(memoryEntryEvidence);
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.evidence_id).sort()).toEqual([e1, e2].sort());

    const found = await store.getById(created.id);
    expect(found?.sourceEvidence).toHaveLength(2);
  });
});
