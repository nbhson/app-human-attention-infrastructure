import { describe, expect, it } from 'vitest';

import { createMemoryEntry, MemoryKind, newEvidenceID } from '@harness/domain';

describe('MemoryKind (day-16 §2.1)', () => {
  it('has exactly the four review-shaped tiers — no code-gen/session tiers', () => {
    expect(Object.values(MemoryKind)).toEqual(['REVIEW', 'FINDING', 'DECISION', 'PROJECT']);
    expect(Object.keys(MemoryKind)).toHaveLength(4);
  });
});

describe('createMemoryEntry (day-16 §2.2)', () => {
  it('defaults id, confidence, counters, null lifecycle fields, and createdAt', () => {
    const evidenceId = newEvidenceID();
    const entry = createMemoryEntry({
      kind: MemoryKind.REVIEW,
      content: 'distilled summary',
      sourceEvidence: [evidenceId],
    });

    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.kind).toBe(MemoryKind.REVIEW);
    expect(entry.sourceEvidence).toEqual([evidenceId]);
    expect(entry.confidence).toBe(0);
    expect(entry.retrievedCount).toBe(0);
    expect(entry.lastRetrievedAt).toBeNull();
    expect(entry.expiresAt).toBeNull();
    expect(entry.supersedes).toBeNull();
    expect(entry.metadata).toEqual({});
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('preserves an explicitly supplied lifecycle chain', () => {
    const head = createMemoryEntry({
      kind: MemoryKind.FINDING,
      content: 'v1',
      sourceEvidence: [newEvidenceID()],
    });
    const successor = createMemoryEntry({
      kind: MemoryKind.FINDING,
      content: 'v2',
      sourceEvidence: [newEvidenceID()],
      supersedes: head.id,
      confidence: 85,
    });

    expect(successor.supersedes).toBe(head.id);
    expect(successor.confidence).toBe(85);
  });
});
