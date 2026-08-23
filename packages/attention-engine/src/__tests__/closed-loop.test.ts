/**
 * Closed-loop tests (day-33 §3.5 acceptance).
 *
 * The state machine (not the fit math — that was day-31) is the thing under test:
 * 1. A full cycle advances stage-by-stage (evaluate → calibrate → deploy → observe).
 * 2. One correlation id joins every stage event to the completion event.
 * 3. HOLD parks at Deploy and the cycle still completes + feeds forward to Evaluate.
 * 4. Observe re-enters Evaluate: the second `runCycle()` feeds from the first's cursor.
 * 5. A collect failure is a `failed` cycle, not a crash, with no fed-forward cursor.
 * 6. The human APPROVE/REJECT gate is untouched — the only events emitted are
 *    `learning.*` (no `review.decision_*`).
 *
 * No DB, no LLM: the collect/fit seams are fakes, the bus is an in-test recorder,
 * and clocks + cycle ids are pinned for determinism.
 */

import { describe, expect, it } from 'vitest';

import { CalibrationJob, DEFAULT_LEARNING_FIT_CONFIG } from '../learning/calibration-job.js';
import { LearningLoop } from '../learning/learning-loop.js';
import type { CollectSeam, FitSeam, LearningCandidate, ReviewFact } from '../learning/types.js';
import { PRIORITY_WEIGHTS } from '../types.js';
import { brand, EventType } from '@harness/domain';
import type { EventEnvelope } from '@harness/domain';
import type { EventHandler, IEventBus, UnsubscribeFn } from '@harness/event-bus';

const T0 = new Date('2026-08-20T00:00:00.000Z');
const T1 = new Date('2026-08-21T00:00:00.000Z');
const T2 = new Date('2026-08-22T00:00:00.000Z'); // the pin: later than every fact

/** A bus that records every published envelope — the test's assertion surface. */
class RecordingBus implements IEventBus {
  readonly published: EventEnvelope<unknown>[] = [];
  publish<T>(event: EventEnvelope<T>): void {
    this.published.push(event as EventEnvelope<unknown>);
  }
  subscribe<T>(eventType: EventType, handler: EventHandler<T>): UnsubscribeFn {
    void eventType;
    void handler;
    return () => {};
  }
}

function makeFact(reviewId: string, recordedAt: Date): ReviewFact {
  return {
    reviewId,
    factors: { risk: 0.7, impact: 0.4, novelty: 0.5, complexity: 0.3, confidence: 0.6 },
    judge: { severityAgreement: 0.8, routingAgreement: 0.9 },
    wasUseful: true,
    recordedAt,
  };
}

function makeCandidate(overrides: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    candidateWeights: PRIORITY_WEIGHTS,
    incumbentWeights: PRIORITY_WEIGHTS,
    improvement: false,
    judgeSignalDominates: false,
    candidateRankingAccuracy: 0.9,
    incumbentRankingAccuracy: 0.9,
    candidateLogLoss: 0.3,
    incumbentLogLoss: 0.3,
    sampleCount: 2,
    ...overrides,
  };
}

function makeCollect(facts: readonly ReviewFact[] = []): CollectSeam {
  return { collect: async () => facts };
}

function makeFit(candidate: LearningCandidate): FitSeam {
  return { fit: () => candidate };
}

/** A loop whose job clock is pinned to `T2` and whose cycle ids are stable. */
function makeLoop(
  candidate: LearningCandidate,
  bus: IEventBus,
  facts: readonly ReviewFact[] = [],
): LearningLoop {
  let n = 0;
  const job = new CalibrationJob(
    makeCollect(facts),
    makeFit(candidate),
    PRIORITY_WEIGHTS,
    DEFAULT_LEARNING_FIT_CONFIG,
    undefined,
    () => T2,
  );
  return new LearningLoop(
    job,
    bus,
    () => brand(`cycle-${++n}`, 'CorrelationID'),
    () => T2,
  );
}

describe('LearningLoop (day-33 §3.1–§3.4)', () => {
  it('advances stage-by-stage in order, under a single correlation id', async () => {
    const bus = new RecordingBus();
    const loop = makeLoop(makeCandidate({ improvement: true }), bus, [
      makeFact('a', T0),
      makeFact('b', T1),
    ]);

    const record = await loop.runCycle(null);

    expect(record.stages.map((s) => s.stage)).toEqual([
      'evaluate',
      'calibrate',
      'deploy',
      'observe',
    ]);
    expect(record.outcome).toBe('completed');
    expect(record.promoted).toBe(true);

    const stageEvents = bus.published.filter(
      (e) => e.event_type === EventType.LearningStageCompleted,
    );
    const completeEvent = bus.published.find(
      (e) => e.event_type === EventType.LearningLoopCompleted,
    );
    expect(stageEvents.map((e) => (e.payload as { stage: string }).stage)).toEqual([
      'evaluate',
      'calibrate',
      'deploy',
      'observe',
    ]);
    expect(completeEvent).toBeDefined();

    // One correlation id joins every event to the cycle.
    const correlationIds = new Set(bus.published.map((e) => e.correlation_id));
    expect(correlationIds.size).toBe(1);
    expect(bus.published.every((e) => e.correlation_id === record.cycleId)).toBe(true);
  });

  it('HOLD parks at Deploy but still completes + feeds forward to Evaluate', async () => {
    const bus = new RecordingBus();
    const loop = makeLoop(makeCandidate({ improvement: false }), bus, [makeFact('a', T0)]);

    const record = await loop.runCycle(null);

    const deploy = record.stages.find((s) => s.stage === 'deploy');
    expect(deploy?.status).toBe('held');
    expect(record.outcome).toBe('held');
    expect(record.promoted).toBe(false);
    // Observe still ran → the loop returns to Evaluate, not a dead end.
    expect(record.stages.some((s) => s.stage === 'observe' && s.status === 'succeeded')).toBe(true);
    expect(record.nextSince).toEqual(T2);
    expect(loop.cursor).toEqual(T2);
  });

  it('Observe re-enters Evaluate: the second cycle feeds from the first cursor', async () => {
    const bus = new RecordingBus();
    const loop = makeLoop(makeCandidate({ improvement: true }), bus, [
      makeFact('a', T0),
      makeFact('b', T1),
    ]);

    const first = await loop.runCycle(null);
    expect(first.sampleCount).toBe(2);

    // No explicit `since` → the fed-forward cursor (T2) is the new window floor;
    // every fact is older than T2, so the second cycle has an empty window.
    const second = await loop.runCycle();
    expect(second.sampleCount).toBe(0);
    expect(second.candidateProposed).toBe(false);
    expect(second.outcome).toBe('completed'); // a clean no-op, not a crash
  });

  it('a collect failure is a failed cycle (no cursor, evaluate marked failed)', async () => {
    const bus = new RecordingBus();
    const collect: CollectSeam = {
      collect: async () => {
        throw new Error('store down');
      },
    };
    const job = new CalibrationJob(collect, makeFit(makeCandidate()), PRIORITY_WEIGHTS);
    const loop = new LearningLoop(
      job,
      bus,
      () => brand('cycle-fail', 'CorrelationID'),
      () => T2,
    );

    const record = await loop.runCycle();

    expect(record.outcome).toBe('failed');
    expect(record.nextSince).toBeNull();
    expect(record.stages.map((s) => s.stage)).toEqual(['evaluate']);
    expect(record.stages[0]?.status).toBe('failed');
  });

  it('never emits a human-decision event — the APPROVE/REJECT gate is untouched', async () => {
    const bus = new RecordingBus();
    const loop = makeLoop(makeCandidate({ improvement: true }), bus, [makeFact('a', T0)]);
    await loop.runCycle(null);

    const types = new Set(bus.published.map((e) => e.event_type));
    expect(types.has(EventType.LearningStageCompleted)).toBe(true);
    expect(types.has(EventType.LearningLoopCompleted)).toBe(true);
    expect([...types].every((t) => t.startsWith('learning.'))).toBe(true);
    // `review.decision_submitted`/related are the human gate — absent here.
    expect([...types].some((t) => t.startsWith('review.'))).toBe(false);
  });
});
