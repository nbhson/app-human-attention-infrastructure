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
 * - {@link DbRankDefaultProvider} — reads the latest arm-B `ab_runs` report with
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
 * Shape of the persisted `ab_runs.report` JSON relevant to the default flip.
 * `recommendation` is the Day-30 cutover call; `rankMethod` names the B arm's
 * ranker so a `promote` maps to the concrete method it promoted.
 */
interface AbRunReportSnapshot {
  rankMethod?: 'keyword' | 'semantic' | 'hybrid';
  recommendation?: 'promote' | 'keep-shadow' | 'real-ab';
}

/**
 * DB-backed resolver: reads the latest `ab_runs` arm-B report whose experiment
 * recommended `promote` and returns the promoted method when it is `hybrid`.
 * Falls back to {@link EnvRankDefaultProvider} when no DB is available or the
 * query returns no promoting result.
 */
export class DbRankDefaultProvider implements RankDefaultResolver {
  constructor(
    private readonly resolveDb: () => import('@harness/db').DrizzleDB,
    private readonly logger: Logger,
  ) {}

  async resolveDefaultRankMethod(): Promise<RankMethod> {
    try {
      const { desc, eq } = await import('drizzle-orm');
      const { abExperiments, abRuns } = await import('@harness/db');
      const db = this.resolveDb();
      const rows = await db
        .select({
          experimentId: abRuns.experiment_id,
          report: abRuns.report,
          createdAt: abRuns.created_at,
        })
        .from(abRuns)
        .innerJoin(abExperiments, eq(abRuns.experiment_id, abExperiments.id))
        .where(eq(abRuns.variant_id, 'B'))
        .orderBy(desc(abRuns.created_at))
        .limit(1);
      const row = rows[0];
      if (row) {
        const report = row.report as AbRunReportSnapshot;
        if (report.recommendation === 'promote' && report.rankMethod === RANK_METHOD_HYBRID) {
          this.logger.info('A/B experiment promoted hybrid as default rank_method', {
            event_type: 'rank_method_promoted',
            experiment_id: row.experimentId,
            variant_b_rank_method: report.rankMethod,
          });
          return RANK_METHOD_HYBRID;
        }
        this.logger.debug('Latest A/B experiment does not promote hybrid', {
          event_type: 'rank_method_not_promoted',
          experiment_id: row.experimentId,
          variant_b_rank_method: report.rankMethod ?? 'missing',
          recommendation: report.recommendation ?? 'missing',
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
