import { describe, expect, it } from 'vitest';

import {
  MemoryKind,
  createContextSnapshot,
  createMemoryEntry,
  newContextID,
  newEvidenceID,
  newTaskID,
} from '@harness/domain';
import type { MemoryProvider, MemoryQuery, MemoryRetrievalResult } from '@harness/domain';

import { MemoryContextResolver } from '../index.js';

/** A deterministic stub behind the domain `MemoryProvider` seam (no DB, no import
 * of `@harness/memory` — the engine consumes the abstract contract only). */
class StubMemoryProvider implements MemoryProvider {
  constructor(private readonly results: readonly MemoryRetrievalResult[]) {}

  async retrieve(_query: MemoryQuery): Promise<readonly MemoryRetrievalResult[]> {
    void _query;
    return this.results;
  }
}

describe('MemoryContextResolver (day-18 §2.3 §3.3)', () => {
  it('injects a top-K `memory` section into the snapshot metadata (immutably)', async () => {
    const entry = createMemoryEntry({
      kind: MemoryKind.REVIEW,
      content: 'payload dereference needs a null check',
      sourceEvidence: [newEvidenceID()],
      confidence: 80,
    });
    const provider = new StubMemoryProvider([{ entry, relevance: 0.91 }]);
    const resolver = new MemoryContextResolver(provider);

    const snapshot = createContextSnapshot({
      id: newContextID(),
      taskId: newTaskID(),
      sources: [],
      totalTokens: 0,
      rankMethod: 'keyword',
    });

    const out = await resolver.inject(snapshot, { text: 'null check payload' });

    const memory = out.metadata.memory as Array<{
      id: string;
      kind: string;
      content: string;
      confidence: number;
      relevance: number;
    }>;
    expect(memory).toHaveLength(1);
    expect(memory[0]?.content).toBe('payload dereference needs a null check');
    expect(memory[0]?.confidence).toBe(80);
    expect(memory[0]?.relevance).toBe(0.91);

    // The input snapshot is untouched (no side effect on the source of truth).
    expect(snapshot.metadata.memory).toBeUndefined();
  });

  it('resolves the same top-K independently of a snapshot', async () => {
    const entry = createMemoryEntry({
      kind: MemoryKind.DECISION,
      content: 'reject until verified',
      sourceEvidence: [newEvidenceID()],
      confidence: 55,
    });
    const resolver = new MemoryContextResolver(new StubMemoryProvider([{ entry, relevance: 0.4 }]));

    const section = await resolver.resolveMemory({ text: 'verify' });
    expect(section).toHaveLength(1);
    expect(section[0]?.kind).toBe('DECISION');
  });
});
