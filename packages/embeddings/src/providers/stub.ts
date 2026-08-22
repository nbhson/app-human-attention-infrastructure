/**
 * Deterministic stub embedder (day-16 §2.2).
 *
 * Maps text to a reproducible unit vector via a pure, seed-derived PRNG — no
 * `Math.random`, no `Date.now`, no network. The same input always yields the
 * same byte-for-byte vector, so tests (and the Day-18 semantic-shadow variant)
 * never reach a live provider. It is the default `TOKENS.Embedder` in bootstrap;
 * a real adapter is opt-in via `EMBEDDINGS_BASE_URL`.
 */

import type { Embedder, EmbedQueryResult, EmbedResult } from '../embedder.js';

/** FNV-1a 32-bit — deterministic, dependency-free string hash. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — a small, deterministic PRNG over a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deterministic embedding provider whose vectors are unit-length in ℝᵈ.
 *
 * The vector is the L2-normalised output of a PRNG seeded from the text's hash,
 * so it is stable across runs *but not semantically meaningful* — it exists to
 * exercise the interface and the shadow path, never to rank real content.
 */
export class StubEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  constructor(dimensions = 1536, model = 'stub-embedding-v0') {
    this.dimensions = dimensions;
    this.model = model;
  }

  async embed(texts: readonly string[]): Promise<EmbedResult> {
    const vectors = texts.map((text) => this.embedOne(text));
    return { ok: true, vectors };
  }

  async embedQuery(text: string): Promise<EmbedQueryResult> {
    const result = await this.embed([text]);
    if (!result.ok) {
      return result;
    }
    return { ok: true, vector: result.vectors[0] as number[] };
  }

  private embedOne(text: string): number[] {
    const rand = mulberry32(fnv1a(text));
    const vector = new Array<number>(this.dimensions);
    let squaredNorm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      const component = rand() * 2 - 1; // uniform in [-1, 1)
      vector[i] = component;
      squaredNorm += component * component;
    }
    const scale = squaredNorm === 0 ? 1 : 1 / Math.sqrt(squaredNorm);
    for (let i = 0; i < this.dimensions; i++) {
      vector[i] = (vector[i] as number) * scale;
    }
    return vector;
  }
}
