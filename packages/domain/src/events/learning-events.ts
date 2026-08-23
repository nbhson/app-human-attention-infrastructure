/**
 * Learning-loop event payloads (review-reorient Phase 3, day-33).
 *
 * The closed loop (`Evaluate → Calibrate → Deploy → Observe`) is a *tracked*
 * state machine: every stage stamp is `learning.stage_completed`, and a cycle's
 * terminal outcome is `learning.loop_completed`. Both carry the same
 * `cycle_id` — which is the {@link CorrelationID} in each event's envelope — so a
 * single id joins every stage, the candidate it fitted, its deploy decision, and
 * the observation that feeds the next cycle.
 */

import type { CorrelationID } from '../ids.js';

/** The four stages of a learning cycle (day-33 §2.1). */
export type LearningStage = 'evaluate' | 'calibrate' | 'deploy' | 'observe';

/** A stage's terminal status. `held` is the guardrail parking at Deploy. */
export type LearningStageStatus = 'succeeded' | 'held' | 'failed';

/**
 * A cycle outcome. `completed` = the cycle ran end-to-end (a PROMOTE, or a clean
 * no-op empty window); `held` = the deploy gate held the candidate (still a full
 * cycle — HOLD is not a dead end, day-33 §2.1); `failed` = a stage threw.
 */
export type LearningOutcome = 'completed' | 'held' | 'failed';

/** Payload for {@link import('./event-types.js').EventType.LearningStageCompleted}. */
export interface LearningStageCompletedPayload {
  /** The cycle this stage belongs to (== the envelope correlation id). */
  readonly cycle_id: CorrelationID;
  /** Which of the four stages just completed. */
  readonly stage: LearningStage;
  /** How the stage ended. */
  readonly status: LearningStageStatus;
  /** Human-readable provenance for the status (e.g. "empty window"). */
  readonly detail: string | null;
}

/** Payload for {@link import('./event-types.js').EventType.LearningLoopCompleted}. */
export interface LearningLoopCompletedPayload {
  /** The cycle id — joins every stage event to this summary. */
  readonly cycle_id: CorrelationID;
  /** Terminal cycle outcome. */
  readonly outcome: LearningOutcome;
  /** Was the candidate promoted this cycle? (false on HOLD or empty window.) */
  readonly promoted: boolean;
  /** Was a candidate even fitted this cycle? */
  readonly candidate_proposed: boolean;
  /** Number of fresh review facts that fed the fit. */
  readonly sample_count: number;
  /**
   * The cursor the *next* Evaluate window starts from (ISO string, or `null` on a
   * failed cycle) — the Observe→Evaluate feed-forward that closes the loop
   * (day-33 §2.3).
   */
  readonly next_since: string | null;
}
