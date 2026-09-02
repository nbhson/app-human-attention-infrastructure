/**
 * Week-6 checkpoint demo (Phase 3 day-30 §3.3) — `pnpm demo:hybrid-default`.
 *
 * Proves the Day-29 cutover discipline, executed as the plan's **§2.3 HOLD path**:
 * the default `rank_method` is `keyword`, `hybrid` (and the opt-in `rag_fusion`)
 * remain *selectable per request* through the one `RetrieverFactory` seam, and the
 * kill-switch — naming `keyword` explicitly — reverts in one line. The default was
 * not won by the measured A/B (day-29 §2.2), so it did not flip; this demo verifies
 * that held state end to end rather than manufacturing a WIN.
 *
 * It runs hermetically: no database, no embedder provider, no LLM. The factory is
 * wired with the **real** `LexicalRetriever` (keyword) + `SemanticDocRetriever`
 * over a deterministic stub candidate source + a stub `QueryRewriter`, so the
 * `HybridRetriever` (RRF fusion) and the factory's resolution logic are the
 * production code. The only thing stubbed — the embedder's cosine ranking — is
 * stated on the line; its ranking is an input to the fusion, not the thing under
 * test.
 */

import {
  EnvRankDefaultProvider,
  LexicalRetriever,
  RANK_METHOD_HYBRID,
  RANK_METHOD_KEYWORD,
  RANK_METHOD_RAG_FUSION,
  RetrieverFactory,
  SemanticDocRetriever,
} from '@harness/context-engine';
import type { QueryRewriter, RetrievedDoc, RetrievalQuery, SemanticCandidate } from '@harness/context-engine';
import type { Logger } from '@harness/di';

/** The shared corpus both layers rank over (one keyword-strong, one content-rich). */
const QUERY: RetrievalQuery = {
  text: 'payment refund',
  targetFiles: [],
  documents: [
    { sourceId: 'src/payment.ts', content: 'export function refund(payment: Payment) {}' },
    { sourceId: 'src/billing.ts', content: 'billing invoice total' },
    { sourceId: 'src/auth.ts', content: 'auth login token' },
  ],
};

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`[demo:hybrid-default] assertion failed: ${label}`);
  }
}

function describeOrder(label: string, docs: readonly RetrievedDoc[]): void {
  const rows = docs.map((doc) => `    ${doc.sourceId.padEnd(16)} matchedBy=${doc.matchedBy}`).join('\n');
  console.log(`  ${label} (${docs.length} docs):\n${rows}`);
}

/**
 * The stubbed embedder's ranking — deterministic, and deliberately *unlike* the
 * keyword layer: keyword surfaces `payment.ts` (token overlap on "payment refund"),
 * semantic surfaces `auth.ts` first (content similarity), so the fusion has a real
 * disagreement to reconcile.
 */
const stubSemanticSource = {
  async retrieve(): Promise<SemanticCandidate[]> {
    return [
      { sourceId: 'src/auth.ts', contentHash: 'h3', embedding: [], similarity: 0.9 },
      { sourceId: 'src/payment.ts', contentHash: 'h1', embedding: [], similarity: 0.6 },
      { sourceId: 'src/billing.ts', contentHash: 'h2', embedding: [], similarity: 0.2 },
    ];
  },
};

/** The stub `QueryRewriter` — RAG fusion's variant generator (day-28), non-empty. */
const stubRewriter: QueryRewriter = {
  async rewrite(query: string): Promise<string[]> {
    return [`${query} variant`];
  },
};

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

async function main(): Promise<void> {
  console.log();
  console.log('demo:hybrid-default — day-30 Week-6 checkpoint (default held at keyword)');
  console.log();

  // The factory is the one seam: keyword (real), semantic (stub embedder), rewriter (stub).
  const factory = new RetrieverFactory(
    new LexicalRetriever(),
    noopLogger,
    undefined,
    new SemanticDocRetriever(stubSemanticSource),
    stubRewriter,
  );

  // --- 1. The held default ----------------------------------------------------
  const defaultProvider = new EnvRankDefaultProvider();
  const defaultRankMethod = await defaultProvider.resolveDefaultRankMethod();
  const byDefault = await factory.resolve(undefined);
  assert(byDefault.method === RANK_METHOD_KEYWORD, 'absent rank_method resolves to keyword');
  console.log(`  1. DEFAULT_RANK_METHOD = "${defaultRankMethod}"  (day-29 A/B: HOLD — not won)`);
  console.log(`     resolve(undefined).method = "${byDefault.method}"`);
  console.log();

  // --- 2. Hybrid remains selectable, and it actually fuses --------------------
  const hybrid = await factory.resolve(RANK_METHOD_HYBRID);
  assert(hybrid.method === RANK_METHOD_HYBRID, "resolve('hybrid') resolves to hybrid");
  const hybridDocs = await hybrid.retrieve(QUERY);
  const matched = new Set(hybridDocs.map((doc) => doc.matchedBy));
  assert(matched.has('both'), 'hybrid fused an overlap (matchedBy: both)');
  console.log('  2. hybrid is selectable, and the fusion is real:');
  describeOrder('hybrid order', hybridDocs);
  console.log();

  // --- 3. Kill-switch: keyword reverts in one line ----------------------------
  const keyword = await factory.resolve(RANK_METHOD_KEYWORD);
  assert(keyword.method === RANK_METHOD_KEYWORD, "resolve('keyword') resolves to keyword");
  const keywordDocs = await keyword.retrieve(QUERY);
  assert(
    keywordDocs.every((doc) => doc.matchedBy === 'lexical'),
    'kill-switch is lexical-only provenance',
  );
  console.log('  3. kill-switch is one line, and it is lexical-only:');
  describeOrder('keyword order', keywordDocs);
  console.log();

  // --- 4. Rag fusion: a further opt-in, never the default ---------------------
  const ragFusion = await factory.resolve(RANK_METHOD_RAG_FUSION);
  assert(ragFusion.method === RANK_METHOD_RAG_FUSION, "resolve('rag_fusion') resolves to rag_fusion");
  const backToDefault = await factory.resolve(undefined);
  assert(backToDefault.method === RANK_METHOD_KEYWORD, 'round-trip: undefined → keyword (default unchanged)');
  console.log('  4. rag_fusion is a further opt-in (never the default):');
  console.log(`     resolve('rag_fusion').method = "${ragFusion.method}"`);
  console.log(`     resolve(undefined).method   = "${backToDefault.method}" (default unchanged)`);
  console.log();

  console.log('week-6 milestone: hybrid is selectable, reversible, and did NOT flip the default. ✅');
}

main().catch((err) => {
  console.error('[demo:hybrid-default] FAILED:', err);
  process.exit(1);
});
