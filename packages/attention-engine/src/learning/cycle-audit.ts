/**
 * Cycle audit (day-33 §3.2) — one correlation id + a per-stage event trail.
 *
 * The four stages of a learning cycle (`evaluate` → `calibrate` → `deploy` →
 * `observe`) are each stamped by a {@link CycleAudit}, which:
 *
 * - owns the cycle's single {@link CorrelationID} (the `cycle_id` that joins every
 *   stage event, the fitted candidate, the deploy decision, and the observation);
 * - records one {@link CycleStageRecord} per stage into an append-only list; and
 * - publishes `learning.stage_completed` per stage and `learning.loop_completed`
 *   once, through an injected {@link IEventBus} (absent in tests → no publish).
 *
 * The audit is deliberately **separate from the orchestration** (`learning-loop.ts`)
 * so the correlation-and-event concern stays unit-testable in isolation: the loop
 * says *what happened at each stage*, the audit says *how it is recorded and
 * traced*.
 */

import { EventType, type LearningOutcome } from '@harness/domain';
import type { CorrelationID, LearningStage, LearningStageStatus } from '@harness/domain';
import { createEvent } from '@harness/event-bus';
import type { IEventBus } from '@harness/event-bus';

/** One stage's terminal record in the append-only trail. */
export interface CycleStageRecord {
  readonly stage: LearningStage;
  readonly status: LearningStageStatus;
  /** UTC timestamp the stage status was recorded. */
  readonly at: Date;
  /** Human-readable provenance (`null` when there is none). */
  readonly detail: string | null;
}

/** The full, auditable result of one learning cycle. */
export interface LearningCycleRecord {
  /** The correlation id joining every stage + the fitted candidate/deploy. */
  readonly cycleId: CorrelationID;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  /** `null` until the cycle reaches a terminal state (`finalize`). */
  readonly outcome: LearningOutcome | null;
  /** The stage trail, in execution order. */
  readonly stages: readonly CycleStageRecord[];
  /** Was a candidate fitted this cycle (false on an empty window). */
  readonly candidateProposed: boolean;
  /** Did the candidate clear the deploy gate (PROMOTE)? */
  readonly promoted: boolean;
  /** Number of fresh review facts that fed the fit. */
  readonly sampleCount: number;
  /** The cursor the next Evaluate window starts from (`null` on failure). */
  readonly nextSince: Date | null;
}

/** A wall-clock seam so stage stamps are deterministic under test. */
type Clock = () => Date;

/**
 * Accumulate one cycle's stage trail and emit its events. Mutates an internal
 * stage list until `finalize`, which returns the immutable {@link LearningCycleRecord}.
 */
export class CycleAudit {
  private readonly stages: CycleStageRecord[] = [];

  constructor(
    private readonly cycleId: CorrelationID,
    private readonly bus: IEventBus | undefined,
    private readonly now: Clock = () => new Date(),
  ) {}

  /** Record a stage's terminal status and publish `learning.stage_completed`. */
  record(stage: LearningStage, status: LearningStageStatus, detail: string | null = null): void {
    const record: CycleStageRecord = { stage, status, at: this.now(), detail };
    this.stages.push(record);
    this.bus?.publish(
      createEvent(EventType.LearningStageCompleted, this.cycleId, {
        cycle_id: this.cycleId,
        stage,
        status,
        detail,
      }),
    );
  }

  /**
   * Mark the cycle terminal, publish `learning.loop_completed`, and return the
   * immutable record. `startedAt` is the timestamp of the first `record` (falling
   * back to `now` for a cycle that never recorded a stage).
   */
  finalize(
    outcome: LearningOutcome,
    summary: {
      readonly candidateProposed: boolean;
      readonly promoted: boolean;
      readonly sampleCount: number;
      readonly nextSince: Date | null;
    },
  ): LearningCycleRecord {
    const startedAt = this.stages[0]?.at ?? this.now();
    const completedAt = this.now();
    this.bus?.publish(
      createEvent(EventType.LearningLoopCompleted, this.cycleId, {
        cycle_id: this.cycleId,
        outcome,
        promoted: summary.promoted,
        candidate_proposed: summary.candidateProposed,
        sample_count: summary.sampleCount,
        next_since: summary.nextSince ? summary.nextSince.toISOString() : null,
      }),
    );
    return {
      cycleId: this.cycleId,
      startedAt,
      completedAt,
      outcome,
      stages: this.stages,
      candidateProposed: summary.candidateProposed,
      promoted: summary.promoted,
      sampleCount: summary.sampleCount,
      nextSince: summary.nextSince,
    };
  }
}
