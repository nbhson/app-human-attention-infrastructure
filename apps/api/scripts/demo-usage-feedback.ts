/**
 * Usage-feedback demo (Phase 3 day-32 §3.2–§3.3) — `pnpm demo:usage-feedback`.
 *
 * Day 32 closes the loop between the human verdict and the ranking: a `UsageLearner`
 * turns per-source usefulness marks into a bounded, time-decayed `[0,1]` signal, and
 * the `ReRanker` consumes that learned signal in place of the day-27 raw-popularity
 * term. This demo runs both pieces of production code keylessly and hermetically —
 * no database, no LLM — with a fixed clock pinned inside `UsageLearner`, so the
 * numbers are deterministic.
 *
 * Three day-32 claims, demonstrated in one run:
 *   1. A useful mark bumps its source above neutral 0.5; a useless mark demotes it.
 *   2. Per-mark influence is capped and old marks decay — no single enthusiast, or
 *      stale feedback, can rewire the ranking.
 *   3. Feeding the learned map into the re-ranker changes the order AND supersedes
 *      the raw `retrievalCount` term (a source the popularity counter loves but
 *      humans marked useless sinks below a proven-useful — but rarely-retrieved —
 *      source).
 */

import { DEFAULT_USAGE_LEARN_CONFIG, ReRanker, UsageLearner } from '@harness/context-engine';
import type { RetrievedDoc, SourceUsefulness } from '@harness/context-engine';

const NOW = 1_800_000_000_000;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`[demo:usage-feedback] assertion failed: ${label}`);
  }
}

function round(value: number): string {
  return value.toFixed(3);
}

function mark(sourceId: string, useful: boolean, observedAtMs: number): SourceUsefulness {
  return { sourceId, useful, observedAtMs };
}

function doc(sourceId: string, score: number): RetrievedDoc {
  return { sourceId, content: `content:${sourceId}`, score, matchedBy: 'both' };
}

async function main(): Promise<void> {
  console.log();
  console.log('demo:usage-feedback — day-32 usefulness → learned usage signal');
  console.log();

  const learner = new UsageLearner(DEFAULT_USAGE_LEARN_CONFIG, () => NOW);

  // --- 1. The core nudge ------------------------------------------------------
  const basic = learner.learn([mark('proven.ts', true, NOW), mark('noisy.ts', false, NOW)]);
  const proven = basic.get('proven.ts')!;
  const noisy = basic.get('noisy.ts')!;
  assert(proven > 0.5, 'useful mark bumps above neutral');
  assert(noisy < 0.5, 'useless mark demotes below neutral');
  console.log('  1. one verdict nudges a source (neutral = 0.5):');
  console.log(`     proven.ts  useful  → ${round(proven)}  (above 0.5)`);
  console.log(`     noisy.ts   useless → ${round(noisy)}  (below 0.5)`);
  console.log();

  // --- 2. Cap + decay ----------------------------------------------------------
  const maxSingle = DEFAULT_USAGE_LEARN_CONFIG.maxSingleMark;
  const saturated = learner.learn(Array.from({ length: 50 }, () => mark('spam.ts', true, NOW)));
  assert(
    saturated.get('spam.ts') === DEFAULT_USAGE_LEARN_CONFIG.maxSignal,
    'many marks saturate at maxSignal, never unbounded',
  );
  const halfLife = DEFAULT_USAGE_LEARN_CONFIG.halfLifeMs;
  const stale = learner.learn([mark('old.ts', true, NOW - halfLife)]);
  assert(
    Math.abs(stale.get('old.ts')! - (0.5 + maxSingle / 2)) < 1e-9,
    'a half-life-old mark halves',
  );
  console.log('  2. per-mark cap and time decay keep it a signal, never a certainty:');
  console.log(
    `     maxSingleMark = ${maxSingle}   maxSignal = ${DEFAULT_USAGE_LEARN_CONFIG.maxSignal}`,
  );
  console.log(`     50 useful marks → ${round(saturated.get('spam.ts')!)}  (capped, not 10.5)`);
  console.log(
    `     mark aged 1 half-life → ${round(stale.get('old.ts')!)}  (0.5 + ${maxSingle}/2)`,
  );
  console.log();

  // --- 3. Learned signal drives the re-rank, superseding raw popularity --------
  const reranker = new ReRanker(undefined, undefined, () => NOW);
  const learned = learner.learn([
    // `raw-pop.ts` is the most-retrieved (10 → popularity 1.0); humans marked it useless.
    mark('raw-pop.ts', false, NOW),
    // `proven.ts` is rarely retrieved (1) but humans marked it useful.
    mark('proven.ts', true, NOW),
  ]);
  const result = reranker.reRank({
    fused: [doc('raw-pop.ts', 1.0), doc('proven.ts', 1.0)],
    changedFiles: [],
    retrievalCount: new Map([
      ['raw-pop.ts', 10],
      ['proven.ts', 1],
    ]),
    learnedUsage: learned,
  });
  const [first] = result;
  assert(first.sourceId === 'proven.ts', 'learned signal supersedes raw popularity in the re-rank');
  console.log('  3. the learned signal re-ranks, and supersedes raw popularity:');
  console.log(`     raw retrievalCount  : raw-pop.ts=10 (popular), proven.ts=1 (rare)`);
  const rawOrder = reranker.reRank({
    fused: [doc('raw-pop.ts', 1.0), doc('proven.ts', 1.0)],
    changedFiles: [],
    retrievalCount: new Map([
      ['raw-pop.ts', 10],
      ['proven.ts', 1],
    ]),
  });
  console.log(`     with only popularity  → ${rawOrder.map((d) => d.sourceId).join(', ')}`);
  console.log(`     with learned usefulness → ${result.map((d) => d.sourceId).join(', ')}`);
  console.log();

  console.log('day-32: usefulness feedback feeds context ranking — proven-useful ranks higher. ✅');
}

main().catch((err) => {
  console.error('[demo:usage-feedback] FAILED:', err);
  process.exit(1);
});
