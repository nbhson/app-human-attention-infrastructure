import { describe, expect, it } from 'vitest';

import { computeIndexHealth, isFreshVector } from '../health.js';
import type { EmbeddingRowSignature } from '../health.js';
import { truncateSource } from '../indexer.js';

/** Build a stored-row signature with sensible defaults, overridable per test. */
function row(sourceId: string, overrides: Partial<EmbeddingRowSignature> = {}): EmbeddingRowSignature {
  return { sourceId, contentHash: 'v1', embedded: true, ...overrides };
}

describe('isFreshVector (day-17 §2.4 read-path guard)', () => {
  it('is fresh only when a vector is present AND its hash is the current version', () => {
    const currentHash = 'abc';
    expect(isFreshVector(row('s', { contentHash: 'abc', embedded: true }), currentHash)).toBe(true);
    // Hash drifted → stale, even though a vector exists.
    expect(isFreshVector(row('s', { contentHash: 'def', embedded: true }), currentHash)).toBe(false);
    // No vector → pending, never servable.
    expect(isFreshVector(row('s', { contentHash: 'abc', embedded: false }), currentHash)).toBe(false);
  });
});

describe('computeIndexHealth (day-17 §3.4)', () => {
  it('reports an all-zero health for an empty source set', () => {
    expect(computeIndexHealth([], [])).toEqual({ total: 0, embedded: 0, pending: 0, stale: 0 });
  });

  it('classifies embedded / pending / stale independently', () => {
    const sources = [
      { sourceId: 'a', contentHash: 'v1' }, // fresh vector
      { sourceId: 'b', contentHash: 'v1' }, // no row at all → pending
      { sourceId: 'c', contentHash: 'v2' }, // row holds v1 → stale
      { sourceId: 'd', contentHash: 'v1' }, // seeded-but-no-vector → pending
    ];
    const rows = [
      row('a', { contentHash: 'v1', embedded: true }),
      row('c', { contentHash: 'v1', embedded: true }),
      row('d', { contentHash: 'v1', embedded: false }),
    ];

    expect(computeIndexHealth(sources, rows)).toEqual({
      total: 4,
      embedded: 1,
      pending: 2,
      stale: 1,
    });
  });

  it('treats a hash mismatch on a pending row as pending, not stale', () => {
    const sources = [{ sourceId: 'a', contentHash: 'v2' }];
    const rows = [row('a', { contentHash: 'v1', embedded: false })];
    expect(computeIndexHealth(sources, rows)).toEqual({
      total: 1,
      embedded: 0,
      pending: 1,
      stale: 0,
    });
  });
});

describe('truncateSource (day-17 §6)', () => {
  it('passes content under the budget through unchanged', () => {
    expect(truncateSource('hello world', 10)).toEqual({ text: 'hello world', truncated: 0 });
  });

  it('cuts to the approximate char budget and reports the tail length', () => {
    // 3 tokens × 4 chars/token = 12-char budget.
    const result = truncateSource('abcdefghijklmnopqrstuvwxyz', 3);
    expect(result.text).toBe('abcdefghijkl');
    expect(result.truncated).toBe(14); // 26 − 12
  });

  it('treats an exact-length boundary as not truncated', () => {
    expect(truncateSource('12345678', 2)).toEqual({ text: '12345678', truncated: 0 }); // 8 chars
  });
});
