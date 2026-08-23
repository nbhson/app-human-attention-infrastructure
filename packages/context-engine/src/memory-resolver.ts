/**
 * Memory context resolver (review-reorient Phase 3, day-18 §2.3 §3.3).
 *
 * Bridges the review-memory read seam into the context snapshot: it pulls top-K
 * memory through the domain `MemoryProvider` contract and injects it as a
 * `memory` section on the snapshot's `metadata` (a `Record<string, unknown>`,
 * so the section rides alongside the existing provenance fields without widening
 * `ContextSnapshot`).
 *
 * Boundary (day-18 §2.3): this module lives in `@harness/context-engine` and
 * imports only `@harness/domain` — never `@harness/memory`. The concrete
 * retriever is supplied via DI (the composition root imports memory; the engine
 * stays engine→seam, never memory→context).
 */

import type { ContextSnapshot, MemoryProvider, MemoryQuery } from '@harness/domain';

/** One injected memory entry (`metadata.memory[i]` on the snapshot). */
export interface ContextMemorySectionEntry {
  readonly id: string;
  readonly kind: string;
  readonly content: string;
  readonly confidence: number;
  readonly relevance: number;
}

export class MemoryContextResolver {
  constructor(private readonly provider: MemoryProvider) {}

  /** Pull top-K memory for `query` as a plain `memory` section (no snapshot). */
  async resolveMemory(query: MemoryQuery): Promise<readonly ContextMemorySectionEntry[]> {
    const results = await this.provider.retrieve(query);
    return results.map((result) => ({
      id: result.entry.id,
      kind: result.entry.kind,
      content: result.entry.content,
      confidence: result.entry.confidence,
      relevance: result.relevance,
    }));
  }

  /**
   * Return `snapshot` with a `memory` section appended to `metadata` (top-K for
   * the query). Immutable — the input snapshot is never mutated.
   */
  async inject(snapshot: ContextSnapshot, query: MemoryQuery): Promise<ContextSnapshot> {
    const memory = await this.resolveMemory(query);
    return { ...snapshot, metadata: { ...snapshot.metadata, memory } };
  }
}
