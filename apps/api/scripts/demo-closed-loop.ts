/**
 * Closed-loop checkpoint demo (Phase 3 day-35 §3.1–§3.3) — `pnpm demo:closed-loop`.
 *
 * The Week-7 milestone, demonstrable in one run: **new human review signals →
 * calibration/routing update → measured (PROMOTE/HOLD) → observed → re-entered.**
 *
 * It seeds a window of review facts (each stands for one human decision's
 * usefulness verdict + a judge's agreement scores), then drives the `LearningLoop`
 * state machine through three scenes:
 *
 *   1. **PROMOTE** — a forced-win fit clears the deploy gate (`deploy=succeeded`).
 *   2. **HOLD** — a no-improvement fit parks at Deploy (`deploy=held`, outcome
 *      `held`) and *still* re-enters Evaluate — the guardrail is the feature.
 *   3. **Re-entry + human gate untouched** — the second PROMOTE cycle feeds from
 *      the first's Observe cursor, and every event emitted is `learning.*` (no
 *      `review.*`), with the seeded decisions unchanged: the loop is read-only
 *      over the human APPROVE/REJECT gate, and `AUTO_APPROVABLE` is not consulted.
 *
 * Keyless + hermetic: the collect/fit seams are fakes, the bus is an in-test
 * logger, and clocks are pinned. Durable-queue transport (day-34) is orthogonal —
 * if `EVENT_TRANSPORT=redis` this same loop rides a `RedisEventsBus`; if `inproc`
 * (default) durability is available-but-not-selected (see `demo:durable-queue`).
 */

import { CalibrationJob, DEFAULT_LEARNING_FIT_CONFIG, LearningLoop } from '@harness/attention-engine';
import type { AttentionWeights, CollectSeam, FitSeam, LearningCandidate, ReviewFact } from '@harness/attention-engine';
import { PRIORITY_WEIGHTS } from '@harness/attention-engine';
import type { EventEnvelope } from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';

const NOW = new Date('2026-08-22T00:00:00.000Z'); // pin: later than every seeded fact

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`[demo:closed-loop] assertion failed: ${label}`);
  }
}

/** A logging bus: prints each event, records for assertion. */
function makeLoggingBus(logged: EventEnvelope<unknown>[]): IEventBus {
  return {
    publish<T>(event: EventEnvelope<T>): void {
      logged.push(event as EventEnvelope<unknown>);
      if (event.event_type.startsWith('learning.')) {
        console.log(`       ↳ ${event.event_type}  (${event.correlation_id})`);
      }
    },
    subscribe<T>(eventType: string, handler: EventHandler<T>): UnsubscribeFn {
      void eventType;
      void handler;
      return () => {};
    },
  };
}

/**
 * A review fact — one human decision's usefulness verdict (`wasUseful`) joined
 * with the LLM judge's agreement scores (`judge`). `judged use` is the demo's
 * label; the loop never sees the raw APPROVE/REJECT decision itself.
 */
function fact(reviewId: string, wasUseful: boolean, at: Date): ReviewFact {
  return {
    reviewId,
    factors: { risk: 0.6, impact: 0.5, novelty: 0.4, complexity: 0.3, confidence: 0.7 },
    judge: { severityAgreement: wasUseful ? 0.9 : 0.35, routingAgreement: wasUseful ? 0.85 : 0.4 },
    wasUseful,
    recordedAt: at,
  };
}

/** Four seeded decisions, all recorded before the pinned `NOW`. */
const SEEDED: readonly ReviewFact[] = [
  fact('rev-104', true, new Date('2026-08-20T00:00:00Z')), // APPROVE, useful
  fact('rev-105', true, new Date('2026-08-20T12:00:00Z')), // APPROVE, useful
  fact('rev-106', false, new Date('2026-08-21T00:00:00Z')), // REJECT, not useful
  fact('rev-107', false, new Date('2026-08-21T12:00:00Z')), // REQUEST_CHANGES, not useful
];

const collect: CollectSeam = { collect: async () => SEEDED };

/** A fit seam that returns a candidate with the given `improvement` verdict. */
function makeFit(improvement: boolean): FitSeam {
  return {
    fit(): LearningCandidate {
      return {
        candidateWeights: {
          risk: 0.4,
          impact: 0.2,
          novelty: 0.15,
          complexity: 0.1,
          confidence: 0.15,
        },
        incumbentWeights: PRIORITY_WEIGHTS,
        improvement,
        judgeSignalDominates: false,
        candidateRankingAccuracy: improvement ? 1 : 0.6,
        incumbentRankingAccuracy: improvement ? 0.6 : 0.95,
        candidateLogLoss: improvement ? 0.2 : 0.55,
        incumbentLogLoss: improvement ? 0.5 : 0.2,
        sampleCount: SEEDED.length,
      };
    },
  };
}

const INCUMBENT: AttentionWeights = PRIORITY_WEIGHTS;

/** Snapshot the seeded decisions so we can prove the loop left them untouched. */
function snapshot(facts: readonly ReviewFact[]): string {
  return JSON.stringify(facts.map((f) => [f.reviewId, f.wasUseful, f.recordedAt.toISOString()]));
}

async function main(): Promise<void> {
  console.log();
  console.log('demo:closed-loop — day-35 Week-7 checkpoint: the loop closes itself');
  console.log();

  const logged: EventEnvelope<unknown>[] = [];
  const before = snapshot(SEEDED);

  // --- 1. PROMOTE: a full cycle, forced WIN ------------------------------------
  const promoteLoop = new LearningLoop(
    new CalibrationJob(collect, makeFit(true), INCUMBENT, DEFAULT_LEARNING_FIT_CONFIG, undefined, () => NOW),
    makeLoggingBus(logged),
  );
  console.log('  1. seeded window → fit → gate (PROMOTE):');
  const promote = await promoteLoop.runCycle(null);
  console.log(`     stages : ${promote.stages.map((s) => `${s.stage}=${s.status}`).join(' → ')}`);
  console.log(`     outcome: ${promote.outcome}   promoted: ${promote.promoted}   samples: ${promote.sampleCount}`);
  assert(
    promote.stages.map((s) => s.stage).join(',') === 'evaluate,calibrate,deploy,observe',
    'PROMOTE cycle advances stage-by-stage',
  );
  assert(promote.promoted, 'a measured WIN promotes');
  console.log();

  // --- 2. HOLD: a no-improvement candidate parks at Deploy ---------------------
  const holdLoop = new LearningLoop(
    new CalibrationJob(collect, makeFit(false), INCUMBENT, DEFAULT_LEARNING_FIT_CONFIG, undefined, () => NOW),
    makeLoggingBus(logged),
  );
  console.log('  2. seeded window → fit → gate (HOLD — the guardrail):');
  const hold = await holdLoop.runCycle(null);
  console.log(`     stages : ${hold.stages.map((s) => `${s.stage}=${s.status}`).join(' → ')}`);
  console.log(`     outcome: ${hold.outcome}   promoted: ${hold.promoted}`);
  const deploy = hold.stages.find((s) => s.stage === 'deploy');
  assert(deploy?.status === 'held', 'HOLD parks at Deploy');
  assert(hold.outcome === 'held', 'a held candidate is a full cycle, not a dead end');
  // Observe still ran → the guardrail re-enters Evaluate, not a stall.
  assert(
    hold.stages.some((s) => s.stage === 'observe' && s.status === 'succeeded'),
    'HOLD still feeds forward to Evaluate',
  );
  assert(hold.nextSince?.toISOString() === NOW.toISOString(), 'HOLD advances the Observe cursor');
  console.log();

  // --- 3. Re-entry + human gate untouched --------------------------------------
  const reenter = await promoteLoop.runCycle(); // no explicit since → Observe→Evaluate
  console.log('  3. re-entry (second cycle feeds from the Observe cursor):');
  console.log(`     outcome: ${reenter.outcome}   samples: ${reenter.sampleCount}`);
  assert(reenter.sampleCount === 0, 'the second cycle sees an empty window (cursor advanced)');
  console.log();

  // --- 4. The human gate is untouched ------------------------------------------
  const types = new Set(logged.map((e) => e.event_type));
  assert(
    [...types].every((t) => t.startsWith('learning.')),
    'every emitted event is a learning.* event',
  );
  assert(
    ![...types].some((t) => t.startsWith('review.')),
    'no review.* event was emitted — the loop never writes a human decision',
  );
  assert(before === snapshot(SEEDED), 'the seeded decisions are unchanged — the loop is read-only');
  const cycleIds = new Set(logged.map((e) => e.correlation_id));
  console.log(`  4. human gate: ${logged.length} events, ${cycleIds.size} cycle ids, all learning.* ✅`);
  console.log('     (APPROVE/REJECT decisions are inputs; AUTO_APPROVABLE is not consulted.)');
  console.log();

  console.log(
    'day-35: the closed loop runs end-to-end, PROMOTE and HOLD both re-enter, and the human gate stays human. ✅',
  );
}

main().catch((error) => {
  console.error('[demo:closed-loop] FAILED:', error);
  process.exit(1);
});
