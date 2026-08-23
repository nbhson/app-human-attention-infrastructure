/**
 * Closed-loop demo (Phase 3 day-33 §3.1–§3.4) — `pnpm demo:closed-loop`.
 *
 * Runs the full `LearningLoop` state machine keylessly and hermetically: a forced-win
 * fit seam (the only measured path to PROMOTE) feeds a real `CalibrationJob`, which
 * the `LearningLoop` wraps in its four-stage cycle — `evaluate → calibrate → deploy →
 * observe` — under one correlation id. A logging bus prints every `learning.*` event,
 * so the audit trail is visible end to end.
 *
 * Two consecutive `runCycle()` calls demonstrate the day-33 claims:
 *   1. One cycle advances stage-by-stage and PROMOTEs on a measured WIN (deploy=succeeded).
 *   2. One correlation id joins every stage event to the completion event.
 *   3. Observe feeds the next Evaluate: the second cycle re-enters with the first's
 *      cursor and sees an empty window (a clean no-op, not a crash).
 *
 * The loop tunes calibration/routing only — the human APPROVE/REJECT gate is not in
 * this state machine (day-33 §2.4).
 */

import {
  CalibrationJob,
  DEFAULT_LEARNING_FIT_CONFIG,
  LearningLoop,
} from '@harness/attention-engine';
import type {
  AttentionWeights,
  CollectSeam,
  FitSeam,
  LearningCandidate,
  ReviewFact,
} from '@harness/attention-engine';
import { PRIORITY_WEIGHTS } from '@harness/attention-engine';
import { EventType } from '@harness/domain';
import type { EventEnvelope } from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';

const NOW = new Date('2026-08-22T00:00:00.000Z'); // pin: later than every fact

function assert(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`[demo:closed-loop] assertion failed: ${label}`);
  }
}

/** A logging bus: prints each `learning.*` event, records for assertion. */
function makeLoggingBus(logged: EventEnvelope<unknown>[]): IEventBus {
  return {
    publish<T>(event: EventEnvelope<T>): void {
      logged.push(event as EventEnvelope<unknown>);
      if (event.event_type.startsWith('learning.')) {
        console.log(`     ↳ event ${event.event_type}  (${event.correlation_id})`);
      }
    },
    subscribe<T>(eventType: string, handler: EventHandler<T>): UnsubscribeFn {
      void eventType;
      void handler;
      return () => {};
    },
  };
}

function fact(reviewId: string, wasUseful: boolean, at: Date): ReviewFact {
  return {
    reviewId,
    factors: { risk: 0.6, impact: 0.5, novelty: 0.4, complexity: 0.3, confidence: 0.7 },
    judge: { severityAgreement: 0.9, routingAgreement: 0.85 },
    wasUseful,
    recordedAt: at,
  };
}

/** Four facts, all recorded before the pinned `NOW` (so cycle 2 sees none). */
const FACTS: readonly ReviewFact[] = [
  fact('r1', true, new Date('2026-08-20T00:00:00Z')),
  fact('r2', true, new Date('2026-08-20T12:00:00Z')),
  fact('r3', false, new Date('2026-08-21T00:00:00Z')),
  fact('r4', false, new Date('2026-08-21T12:00:00Z')),
];

const collect: CollectSeam = { collect: async () => FACTS };

/** A forced-win fit — the only measured path to PROMOTE (day-31 §3.3). */
const fit: FitSeam = {
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
      improvement: true,
      judgeSignalDominates: false,
      candidateRankingAccuracy: 1,
      incumbentRankingAccuracy: 0.6,
      candidateLogLoss: 0.2,
      incumbentLogLoss: 0.5,
      sampleCount: FACTS.length,
    };
  },
};

const INCUMBENT: AttentionWeights = PRIORITY_WEIGHTS;

async function main(): Promise<void> {
  console.log();
  console.log('demo:closed-loop — day-33 evaluate → calibrate → deploy → observe');
  console.log();

  const logged: EventEnvelope<unknown>[] = [];
  const loop = new LearningLoop(
    new CalibrationJob(collect, fit, INCUMBENT, DEFAULT_LEARNING_FIT_CONFIG, undefined, () => NOW),
    makeLoggingBus(logged),
  );

  // --- 1. First cycle: full advance + PROMOTE ----------------------------------
  const first = await loop.runCycle(null);
  console.log('  1. first cycle (fresh window, forced WIN):');
  console.log(`     stages : ${first.stages.map((s) => `${s.stage}=${s.status}`).join(' → ')}`);
  console.log(`     outcome: ${first.outcome}   promoted: ${first.promoted}`);
  console.log(`     samples: ${first.sampleCount}`);
  assert(
    first.stages.map((s) => s.stage).join(',') === 'evaluate,calibrate,deploy,observe',
    'stage-by-stage',
  );
  assert(first.outcome === 'completed', 'WIN cycle completes');
  assert(first.promoted, 'WIN cycle promoted');
  console.log();

  // --- 2. Second cycle: Observe → Evaluate re-entry ----------------------------
  const second = await loop.runCycle(); // re-enters with the fed-forward cursor
  console.log('  2. second cycle (no explicit since → re-enters with the Observe cursor):');
  console.log(`     stages : ${second.stages.map((s) => `${s.stage}=${s.status}`).join(' → ')}`);
  console.log(`     outcome: ${second.outcome}   samples: ${second.sampleCount}`);
  assert(second.sampleCount === 0, 'second cycle sees an empty window');
  assert(second.outcome === 'completed', 'empty window is a clean no-op');
  console.log();

  // --- 3. One correlation id joins every event ---------------------------------
  const cycleIds = new Set(logged.map((e) => e.correlation_id));
  assert(cycleIds.size === 2, 'one correlation id per cycle');
  const completedEvents = logged.filter((e) => e.event_type === EventType.LearningLoopCompleted);
  assert(completedEvents.length === 2, 'one learning.loop_completed per cycle');
  console.log(
    `  3. correlation: ${logged.length} events across ${cycleIds.size} cycle ids (all traced) ✅`,
  );
  console.log();

  console.log('day-33: the learning loop runs as one observable, auditable cycle. ✅');
}

main().catch((err) => {
  console.error('[demo:closed-loop] FAILED:', err);
  process.exit(1);
});
