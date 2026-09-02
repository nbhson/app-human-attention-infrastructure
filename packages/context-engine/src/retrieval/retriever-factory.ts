/**
 * Retriever factory (day-26 §2.3, extended day-28 §3.3, day-41 CF-1).
 *
 * Selection is config, not code: callers name a `rank_method` and get the
 * retriever for it, without any caller branching on which one exists.
 *
 * The default is resolved at runtime via {@link RankDefaultResolver} so that
 * a measured A/B WIN (hybrid promoted in `ab_experiments`) can flip the default
 * without a redeploy — only a env override or a DB row matters.
 *
 * Unknown or absent methods degrade to `keyword` — a mis-spelled rank_method is
 * a degraded ranking, not a crash.
 */

import { HybridRetriever } from './hybrid-retriever.js';
import type { QueryRewriter } from './query-rewriter.js';
import { DEFAULT_VARIANT_COUNT } from './query-rewriter.js';
import { RagFusionRetriever } from './rag-fusion-retriever.js';
import type { Retriever } from './retriever.js';
import type { Logger } from '@harness/di';
import { eq } from 'drizzle-orm';

/** The day-26 default ranking method. */
export const RANK_METHOD_KEYWORD = 'keyword';
/** The fused method — selectable now, default only after a live A/B WIN. */
export const RANK_METHOD_HYBRID = 'hybrid';
/** The opt-in multi-query method (day-28 §2.2) — never the default. */
export const RANK_METHOD_RAG_FUSION = 'rag_fusion';

/** The resolvable rank methods. */
export type RankMethod =
  typeof RANK_METHOD_KEYWORD | typeof RANK_METHOD_HYBRID | typeof RANK_METHOD_RAG_FUSION;

/**
 * Resolves the current production-default `rank_method` at runtime.
 *
 * Implementations:
 * - {@link EnvRankDefaultProvider} — reads `DEFAULT_RANK_METHOD` env var (default: `keyword`).
 * - {@link DbRankDefaultProvider} — reads the latest `ab_experiments` row with
 *   `recommendation = 'promote'` and falls back to `keyword`.
 */
export interface RankDefaultResolver {
  resolveDefaultRankMethod(): Promise<RankMethod>;
}

/**
 * Default resolver: reads from env. `DEFAULT_RANK_METHOD` env var overrides
 * the compiled-in default; any unknown value degrades to `keyword`.
 */
export class EnvRankDefaultProvider implements RankDefaultResolver {
  async resolveDefaultRankMethod(): Promise<RankMethod> {
    const env = process.env.DEFAULT_RANK_METHOD;
    if (env === RANK_METHOD_HYBRID || env === RANK_METHOD_RAG_FUSION) return env;
    return RANK_METHOD_KEYWORD;
  }
}

/**
 * Type-safe shape for the `variant_b` JSON column in `ab_experiments`.
 * Extend when new variant fields are added.
 */
interface VariantBSnapshot {
  rank_method?: string;
  // future fields: retriever_config?, embedding_model?, etc.
}

/**
 * DB-backed resolver: reads the latest promoted experiment from `ab_experiments`
 * where `recommendation = 'promote'` and returns the variant B method when the
 * recommendation is `promote`. Falls back to {@link EnvRankDefaultProvider} when
 * no DB is available or the query returns no result.
 */
export class DbRankDefaultProvider implements RankDefaultResolver {
  constructor(
    private readonly resolveDb: () => import('@harness/db').DrizzleDB,
    private readonly logger: Logger,
  ) {}

  async resolveDefaultRankMethod(): Promise<RankMethod> {
    try {
      const { desc } = await import('drizzle-orm');
      const { abExperiments } = await import('@harness/db');
      const db = this.resolveDb();
      const row = await db
        .select()
        .from(abExperiments)
        .where(eq(abExperiments.recommendation, 'promote'))
        .orderBy(desc(abExperiments.created_at))
        .limit(1);
      if (row[0]) {
        const variantB = row[0].variant_b as VariantBSnapshot;
        if (variantB?.rank_method === RANK_METHOD_HYBRID) {
          this.logger.info('A/B experiment promoted hybrid as default rank_method', {
            event_type: 'rank_method_promoted',
            experiment_id: row[0].id,
            variant_b_rank_method: variantB.rank_method,
          });
          return RANK_METHOD_HYBRID;
        }
        this.logger.debug('Latest A/B experiment does not promote hybrid', {
          event_type: 'rank_method_not_promoted',
          experiment_id: row[0].id,
          variant_b_rank_method: variantB?.rank_method ?? 'missing',
        });
      }
    } catch (err) {
      this.logger.warn('DB error reading A/B experiment, falling back to env resolver', {
        event_type: 'rank_method_fallback_env',
        reason: 'db_error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return new EnvRankDefaultProvider().resolveDefaultRankMethod();
  }
}

/** The in-process default (env-backed) used when no resolver is supplied. */
const DEFAULT_RESOLVER = new EnvRankDefaultProvider();

export class RetrieverFactory {
  private readonly hybrid: Retriever | null;
  private readonly ragFusion: Retriever | null;
  private readonly defaultResolver: RankDefaultResolver;
  private readonly logger: Logger;

  constructor(
    private readonly keyword: Retriever,
    logger: Logger,
    defaultResolver: RankDefaultResolver = DEFAULT_RESOLVER,
    semantic?: Retriever,
    rewriter?: QueryRewriter,
    variantCount: number = DEFAULT_VARIANT_COUNT,
  ) {
    this.logger = logger;
    this.defaultResolver = defaultResolver;
    // hybrid exists only when the semantic layer is wired in; rag_fusion wraps
    // the hybrid and exists only when a rewriter is supplied too. Without the
    // dependency, the method resolves to keyword (same as unknown).
    this.hybrid = semantic ? new HybridRetriever(keyword, semantic) : null;
    this.ragFusion =
      this.hybrid && rewriter ? new RagFusionRetriever(this.hybrid, rewriter, variantCount) : null;
  }

  /**
   * Resolve a `rank_method` to its retriever.
   * When `rankMethod` is absent, delegates to the runtime default resolver.
   * An explicit unknown method degrades to keyword.
   */
  async resolve(rankMethod: string | undefined): Promise<Retriever> {
    let target: string;
    if (rankMethod !== undefined) {
      target = rankMethod;
    } else {
      target = await this.defaultResolver.resolveDefaultRankMethod();
      this.logger.debug('Resolved default rank_method from resolver', {
        event_type: 'rank_method_resolved',
        resolved_method: target,
        resolver: this.defaultResolver.constructor.name,
      });
    }
    if (target === RANK_METHOD_RAG_FUSION && this.ragFusion) {
      return this.ragFusion;
    }
    if (target === RANK_METHOD_HYBRID && this.hybrid) {
      return this.hybrid;
    }
    if (target !== RANK_METHOD_KEYWORD) {
      this.logger.warn('Unknown or unavailable rank_method, degrading to keyword', {
        event_type: 'rank_method_degraded',
        requested_method: target,
        fallback_method: RANK_METHOD_KEYWORD,
      });
    }
    return this.keyword;
  }
}
