/**
 * Shadow rank-comparison path (day-18 §2.2, §2.4) — the A/B harness's raw material.
 *
 * This is write-only telemetry. When `semanticShadowEnabled` is ON, the engine
 * resolves the context *twice* — keyword (served) and semantic (logged only) — and
 * records both orderings plus an agreement metric. It never feeds back into the
 * served snapshot, whose `rank_method` stays keyword (the §2.3 invariant). The
 * `semantic` method string lives *only* here, in the shadow record.
 */

import { shadowRankComparisons } from '@harness/db';
import type { DrizzleDB } from '@harness/db';
import { uuidv7 } from '@harness/domain';

/** The shadow-only `rank_method` value — never written to a served snapshot. */
export const SEMANTIC_RANK_METHOD = 'semantic';

/** The two orderings to compare, before the correlation is computed. */
export interface ShadowComparisonInput {
  readonly taskId: string;
  readonly contextId: string;
  /** Serviced keyword ordering — sourceIds in descending relevance. */
  readonly keywordOrder: readonly string[];
  /** Shadow semantic ordering — sourceIds in descending cosine similarity. */
  readonly semanticOrder: readonly string[];
  /** The k used for the top-k correlation (the injected context size). */
  readonly topK: number;
}

/**
 * Kendall tau correlation between two rankings, over their *intersection*. The
 * caller is expected to pass already-truncated top-k lists (day-18 §6: correlate
 * only the handful of items that would actually be injected, not a full
 * permutation). Returns `null` when fewer than two sources are shared — no
 * agreement signal exists on a (near-)disjoint pair.
 *
 * Ranges in [-1, 1]: `1` = identical order, `-1` = reversed, `0` = unrelated.
 */
export function kendallTau(a: readonly string[], b: readonly string[]): number | null {
  const inB = new Set(b);
  const common = a.filter((id) => inB.has(id)); // intersection, in `a`'s order
  if (common.length < 2) return null;

  const rankInB = new Map(b.map((id, index) => [id, index]));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < common.length; i += 1) {
    for (let j = i + 1; j < common.length; j += 1) {
      const bi = rankInB.get(common[i] as string) ?? 0;
      const bj = rankInB.get(common[j] as string) ?? 0;
      if (bi < bj) concordant += 1;
      else if (bi > bj) discordant += 1;
      // bi === bj cannot happen for a strict ordering over distinct ids.
    }
  }
  const pairs = (common.length * (common.length - 1)) / 2;
  return (concordant - discordant) / pairs;
}

/** Persists one shadow comparison row; correlation computed over the top-k. */
export class ShadowRankWriter {
  constructor(private readonly db: DrizzleDB) {}

  async write(input: ShadowComparisonInput): Promise<void> {
    const tau = kendallTau(
      input.keywordOrder.slice(0, input.topK),
      input.semanticOrder.slice(0, input.topK),
    );
    await this.db.insert(shadowRankComparisons).values({
      id: uuidv7(),
      task_id: input.taskId,
      context_id: input.contextId,
      keyword_order: [...input.keywordOrder],
      semantic_order: [...input.semanticOrder],
      rank_correlation: tau === null ? null : String(tau),
      top_k: input.topK,
    });
  }
}
